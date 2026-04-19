/**
 * vocab-review/js/app.js
 *
 * 新版词汇复习系统入口：
 * - 首页：围绕任务单状态和周录入概览
 * - 单词本：按周次筛选，基础词汇 / 拓展词汇双表
 * - 今日任务单：生成、预览、导出打印
 * - 批改：上传、复核、完成状态流
 * - 统计：家庭复习概览
 * - 设置：预算、曲线、提醒等配置
 */

'use strict';

import { createRouter } from '../../shared/router.js';
import { checkIndexedDBAvailable } from '../../shared/db.js';
import { initTheme, loadThemePreference, saveThemePreference } from '../../shared/theme.js';
import {
  initDB,
  getTodayStr,
  getMasteryStats,
  getAllWords,
  getAllWeeks,
  upsertWeek,
  addWords,
  exportAllData,
  getDailyTask,
  updateDailyTask,
  listDailyTasks,
  updateProgress,
} from './db.js';
import { buildDailyTask } from './scheduler.js';
import { initStats } from './stats.js';
import { loadSettings, saveSettings } from './settings.js';

const OCR_ASSET_BASE = '/vocab-review/vendor/tesseract';
const OCR_SCRIPT_PATH = `${OCR_ASSET_BASE}/dist/tesseract.min.js`;
const OCR_WORKER_PATH = `${OCR_ASSET_BASE}/dist/worker.min.js`;
const OCR_CORE_PATH = `${OCR_ASSET_BASE}/core`;
const OCR_LANG_PATH = `${OCR_ASSET_BASE}/lang-data/4.0.0_best_int`;

async function main() {
  initTheme();

  const idbOk = await checkIndexedDBAvailable();
  if (!idbOk) {
    showFatalError('当前浏览器/模式不支持本地存储\n请退出隐私模式后重试');
    return;
  }

  try {
    await initDB();
  } catch (err) {
    showFatalError(`数据库初始化失败：${err.message}`);
    return;
  }

  registerSW();
  bindBottomNav();

  const router = createRouter({
    '/':        () => showPage('home', renderHome),
    '/words':   () => showPage('words', renderWords),
    '/tasks':   () => showPage('tasks', renderTasks),
    '/grading': () => showPage('grading', renderGrading),
    '/import':  () => showPage('import', renderImport),
    '/stats':   () => showPage('stats', renderStatsPage),
    '/settings':() => showPage('settings', renderSettings),
  });

  router.start();
  window._router = router;

  const btnUpdate = document.getElementById('btnSwUpdate');
  const btnDismiss = document.getElementById('btnSwDismiss');
  btnUpdate?.addEventListener('click', () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  });
  btnDismiss?.addEventListener('click', () => {
    document.getElementById('swUpdateBanner')?.classList.add('hidden');
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/vocab-review/sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          document.getElementById('swUpdateBanner')?.classList.remove('hidden');
        }
      });
    });
  }).catch(err => {
    console.warn('[SW] 注册失败（非致命）:', err);
  });
}

const PAGE_MAP = {
  home: 'pageHome',
  tasks: 'pagePractice',
  words: 'pageWords',
  import: 'pageImport',
  grading: 'pageErrors',
  stats: 'pageStats',
  settings: 'pageSettings',
};

const NAV_ROUTE_MAP = {
  home: '/',
  tasks: '/tasks',
  words: '/words',
  grading: '/grading',
  stats: '/stats',
  settings: '/settings',
};

async function showPage(pageName, renderFn) {
  Object.values(PAGE_MAP).forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  const target = document.getElementById(PAGE_MAP[pageName]);
  if (!target) return;

  target.classList.remove('hidden');
  updateNavActive(pageName);

  if (renderFn) await renderFn(target);
}

function bindBottomNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const route = btn.dataset.route;
      if (route) window._router?.go(route);
    });
  });
}

function updateNavActive(pageName) {
  const route = NAV_ROUTE_MAP[pageName] || '/';
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
}

async function renderHome(container) {
  setHeaderTitle('单词复习总览');
  setBackBtn(false);
  container.innerHTML = renderLoading();

  try {
    const settings = loadSettings();
    const [task, weeks, words, mastery, tasks] = await Promise.all([
      buildDailyTask(settings),
      getAllWeeks(),
      getAllWords(),
      getMasteryStats(),
      listDailyTasks(),
    ]);

    const latestWeek = pickLatestWeek(weeks);
    const currentWeekWords = latestWeek ? words.filter(word => word.week_id === latestWeek.id) : [];
    const basicCurrent = currentWeekWords.filter(word => word.word_type === 'spelling');
    const extendedCurrent = currentWeekWords.filter(word => word.word_type !== 'spelling');
    const highRiskCount = words.filter(word => word.progress?.mastery_level === 'red').length;
    const errorCount = words.filter(word => (word.progress?.total_wrong || 0) > 0).length;
    const latestTasks = tasks.slice(0, 3);

    container.innerHTML = `
      <section class="hero-panel">
        <div class="hero-copy">
          <span class="eyebrow">今日任务单</span>
          <h2>${task.summary.totalWords} 个词待处理</h2>
          <p>基础词汇 ${task.summary.basicCount} 个，拓展词汇 ${task.summary.extendedCount} 个。今日提醒时间 ${esc(task.summary.reminderTime)}。</p>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary" id="btnOpenTask">查看今日任务单</button>
          <button class="btn btn-secondary" id="btnOpenImport">录入本周单词</button>
        </div>
      </section>

      <section class="stat-grid">
        <article class="stat-card accent-blue">
          <div class="stat-label">任务状态</div>
          <div class="stat-value">${task.statusLabel || taskStatusLabel(task.status)}</div>
          <div class="stat-meta">已生成，可导出 PDF 并打印</div>
        </article>
        <article class="stat-card accent-orange">
          <div class="stat-label">${latestWeek ? esc(latestWeek.label) : '本周录入'}</div>
          <div class="stat-value">${currentWeekWords.length}</div>
          <div class="stat-meta">基础 ${basicCurrent.length} / 拓展 ${extendedCurrent.length}</div>
        </article>
        <article class="stat-card accent-red">
          <div class="stat-label">高风险词</div>
          <div class="stat-value">${highRiskCount}</div>
          <div class="stat-meta">累计出错词 ${errorCount} 个</div>
        </article>
        <article class="stat-card accent-green">
          <div class="stat-label">掌握分层</div>
          <div class="stat-value">${mastery.green}</div>
          <div class="stat-meta">已掌握 ${mastery.green} / 学习中 ${mastery.yellow} / 红词 ${mastery.red}</div>
        </article>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">今日闭环</div>
            <h3>任务单状态追踪</h3>
          </div>
        </div>
        <div class="status-track">
          ${renderStatusStep('待生成', false)}
          ${renderStatusStep('已生成', true)}
          ${renderStatusStep('待打印', ['generated', 'printed', 'uploaded', 'reviewing', 'completed'].includes(task.status))}
          ${renderStatusStep('待上传', ['uploaded', 'reviewing', 'completed'].includes(task.status))}
          ${renderStatusStep('待复核', ['reviewing', 'completed'].includes(task.status))}
          ${renderStatusStep('已完成', task.status === 'completed')}
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">快捷入口</div>
            <h3>围绕纸质任务单工作</h3>
          </div>
        </div>
        <div class="quick-grid">
          ${quickActionButton('任务单预览', '查看、导出、打印今日 PDF', 'tasks')}
          ${quickActionButton('上传与批改', '记录照片上传、复核和完成状态', 'grading')}
          ${quickActionButton('单词本', '按录入周数筛选基础词汇 / 拓展词汇', 'words')}
          ${quickActionButton('录入单词', '本周老师词表导入与分类', 'import')}
        </div>
      </section>

      <section class="panel panel-list">
        <div class="section-head">
          <div>
            <div class="section-kicker">最近任务</div>
            <h3>最近 3 次任务单记录</h3>
          </div>
        </div>
        ${latestTasks.length ? latestTasks.map(item => `
          <div class="list-row">
            <div>
              <div class="list-title">${esc(item.date)}</div>
              <div class="list-meta">基础 ${item.summary?.basicCount || 0} · 拓展 ${item.summary?.extendedCount || 0}</div>
            </div>
            <span class="status-pill">${esc(taskStatusLabel(item.status))}</span>
          </div>
        `).join('') : renderEmptyInline('还没有历史任务单')}
      </section>
    `;

    container.querySelector('#btnOpenTask')?.addEventListener('click', () => window._router?.go('/tasks'));
    container.querySelector('#btnOpenImport')?.addEventListener('click', () => window._router?.go('/import'));
    container.querySelectorAll('[data-quick-route]').forEach(btn => {
      btn.addEventListener('click', () => window._router?.go(`/${btn.dataset.quickRoute}`));
    });
  } catch (err) {
    container.innerHTML = renderError(err.message);
  }
}

async function renderTasks(container) {
  setHeaderTitle('今日任务单');
  setBackBtn(false);
  container.innerHTML = renderLoading();

  try {
    const settings = loadSettings();
    const task = await buildDailyTask(settings);

    container.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">${esc(task.date)}</div>
            <h3>任务单预览</h3>
          </div>
          <span class="status-pill">${esc(taskStatusLabel(task.status))}</span>
        </div>
        <p class="section-desc">基础词汇区采用左右两列不同出题方向，拓展词汇区展示词义并预留批改列。当前版本通过浏览器打印功能导出 PDF。</p>
        <div class="task-toolbar">
          <button class="btn btn-primary" id="btnPrintTask">导出 / 打印 PDF</button>
          <button class="btn btn-secondary" id="btnMarkPrinted">标记已打印</button>
          <button class="btn btn-ghost" id="btnGoGrading">前往批改</button>
        </div>
      </section>

      <section class="sheet-preview" id="taskSheetPreview">
        ${renderTaskSheet(task)}
      </section>
    `;

    container.querySelector('#btnPrintTask')?.addEventListener('click', async () => {
      const opened = await openPrintView(task);
      if (!opened) return;

      await updateDailyTask(task.date, { status: 'printed', printed_at: new Date().toISOString() });
      showToast('已打开系统打印窗口，可选择“存储为 PDF”');
      await renderTasks(container);
    });

    container.querySelector('#btnMarkPrinted')?.addEventListener('click', async () => {
      await updateDailyTask(task.date, { status: 'printed', printed_at: new Date().toISOString() });
      showToast('已标记为已打印');
      await renderTasks(container);
    });

    container.querySelector('#btnGoGrading')?.addEventListener('click', () => window._router?.go('/grading'));
  } catch (err) {
    container.innerHTML = renderError(err.message);
  }
}

async function renderWords(container) {
  setHeaderTitle('单词本');
  setBackBtn(false);
  container.innerHTML = renderLoading();

  try {
    const [words, weeks] = await Promise.all([getAllWords(), getAllWeeks()]);
    if (!words.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">单词本为空</div>
          <div class="empty-state-desc">先录入本周老师布置的基础词汇和拓展词汇。</div>
          <button class="btn btn-primary" id="btnGoImport">去录入</button>
        </div>
      `;
      container.querySelector('#btnGoImport')?.addEventListener('click', () => window._router?.go('/import'));
      return;
    }

    const sortedWeeks = [...weeks].sort((a, b) => b.week_number - a.week_number);
    const defaultWeek = sortedWeeks[0]?.id || words[0]?.week_id;
    container.innerHTML = renderWordsPage(words, sortedWeeks, defaultWeek);

    const weekFilter = container.querySelector('#weekFilter');
    weekFilter?.addEventListener('change', () => {
      const weekId = Number(weekFilter.value);
      container.innerHTML = renderWordsPage(words, sortedWeeks, weekId);
      bindWordsPage(container, words, sortedWeeks);
    });

    bindWordsPage(container, words, sortedWeeks);
  } catch (err) {
    container.innerHTML = renderError(err.message);
  }
}

function bindWordsPage(container, words, weeks) {
  container.querySelector('#btnGoImportInline')?.addEventListener('click', () => window._router?.go('/import'));
  const weekFilter = container.querySelector('#weekFilter');
  weekFilter?.addEventListener('change', () => {
    const weekId = Number(weekFilter.value);
    container.innerHTML = renderWordsPage(words, weeks, weekId);
    bindWordsPage(container, words, weeks);
  });
}

function renderWordsPage(words, weeks, selectedWeekId) {
  const selectedWeek = weeks.find(week => week.id === selectedWeekId);
  const weekWords = words.filter(word => Number(word.week_id) === Number(selectedWeekId));
  const basicWords = weekWords.filter(word => word.word_type === 'spelling');
  const extendedWords = weekWords.filter(word => word.word_type !== 'spelling');

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">按录入周数查看</div>
          <h3>${selectedWeek ? esc(selectedWeek.label) : '选择周次'}</h3>
        </div>
        <button class="btn btn-secondary btn-sm" id="btnGoImportInline">录入新单词</button>
      </div>
      <div class="filter-row">
        <label class="filter-label" for="weekFilter">录入周次</label>
        <select class="form-select compact-select" id="weekFilter">
          ${weeks.map(week => `<option value="${week.id}" ${week.id === selectedWeekId ? 'selected' : ''}>${esc(week.label)}</option>`).join('')}
        </select>
      </div>
    </section>

    ${renderWordTableSection('基础词汇', 'spelling', basicWords, '中文写英文 + 英文写中文的高优先池')}
    ${renderWordTableSection('拓展词汇', 'recognition', extendedWords, '识记型词汇，系统维持低频抽查与回炉')}
  `;
}

function renderWordTableSection(title, type, words, description) {
  return `
    <section class="panel table-panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">${type === 'spelling' ? '基础词汇表' : '拓展词汇表'}</div>
          <h3>${esc(title)}</h3>
        </div>
        <span class="status-pill">${words.length} 个</span>
      </div>
      <p class="section-desc">${esc(description)}</p>
      ${words.length ? `
      <div class="table-shell">
        <table class="data-table">
          <thead>
            <tr>
              <th>英文</th>
              <th>中文</th>
              <th>录入时间</th>
              <th>累计错误次数</th>
              <th>掌握层级</th>
            </tr>
          </thead>
          <tbody>
            ${words
              .sort((a, b) => String(a.english).localeCompare(String(b.english)))
              .map(word => `
                <tr>
                  <td>${esc(word.english)}</td>
                  <td>${esc(word.chinese)}</td>
                  <td>${esc(formatDateTime(word.created_at))}</td>
                  <td>${word.progress?.total_wrong || 0}</td>
                  <td>${renderMasteryChip(word.progress?.mastery_level || 'red')}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>` : renderEmptyInline(`当前周还没有${title}`)}
    </section>
  `;
}

async function renderImport(container) {
  setHeaderTitle('录入单词');
  setBackBtn(true, '/words');

  const weeks = await getAllWeeks();
  const weekOptions = weeks
    .sort((a, b) => b.week_number - a.week_number)
    .map(w => `<option value="${w.id}">${esc(w.label)}</option>`)
    .join('');

  container.innerHTML = `
    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">周录入入口</div>
          <h3>周次管理</h3>
        </div>
      </div>
      <div class="inline-form">
        <input type="number" class="form-input" id="newWeekNum" placeholder="周次编号" min="1" />
        <input type="text" class="form-input" id="newWeekLabel" placeholder="如：第1周（Day1-Home and Colours）" />
        <button class="btn btn-secondary" id="btnAddWeek">添加周次</button>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">批量录入</div>
          <h3>粘贴词表或 CSV</h3>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">选择周次</label>
          <select class="form-select" id="selectWeek">
            <option value="">— 请先选择周次 —</option>
            ${weekOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">单词类型</label>
          <select class="form-select" id="selectWordType">
            <option value="spelling">基础词汇（需要会写）</option>
            <option value="recognition">拓展词汇（认识即可）</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">单词数据</label>
        <textarea class="form-textarea" id="wordData" rows="8" placeholder="每行一个，格式：英文,中文,词性（词性可省略）&#10;例如：&#10;bed,床,n.&#10;blue,蓝色的,adj."></textarea>
      </div>
      <div class="task-toolbar">
        <button class="btn btn-primary" id="btnImport">导入单词</button>
        <button class="btn btn-ghost" id="btnExport">导出全部数据</button>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">截图导入</div>
          <h3>识别截图后填入词表</h3>
        </div>
      </div>
      <p class="section-desc">上传或直接粘贴老师词表截图，系统会先做 OCR 识别，并把解析结果填到上方“单词数据”文本框。你确认无误后，再点击“导入单词”。</p>
      <div class="form-group">
        <label class="form-label">词表截图</label>
        <div class="paste-upload" id="ocrPasteZone" tabindex="0" role="button" aria-label="上传老师词表截图，支持选择文件或直接粘贴图片">
          <input type="file" class="form-input" id="ocrImageFile" accept="image/*" />
          <div class="paste-upload-meta" id="ocrUploadMeta">
            支持选择老师词表截图，也支持直接粘贴截图。识别结果会先回填到上方文本框，确认后再导入。
          </div>
        </div>
      </div>
      <div class="task-toolbar">
        <button class="btn btn-secondary" id="btnRecognizeImage">识别截图并填入词表</button>
      </div>
      <div class="placeholder-card">
        <strong>当前策略：</strong> 先识别并回填文本，再沿用现有导入按钮落库，避免 OCR 误识别直接写入单词库。
      </div>
    </section>
  `;

  bindImportEvents(container);
}

function bindImportEvents(container) {
  const wordDataInput = container.querySelector('#wordData');
  const ocrFileInput = container.querySelector('#ocrImageFile');
  const ocrPasteZone = container.querySelector('#ocrPasteZone');
  const ocrMeta = container.querySelector('#ocrUploadMeta');
  const btnRecognize = container.querySelector('#btnRecognizeImage');
  let selectedOcrImage = null;
  let ocrStatusMode = 'idle';

  const renderIdleOCRHint = () => {
    ocrMeta.textContent = '支持选择老师词表截图，也支持直接粘贴截图。识别结果会先回填到上方文本框，确认后再导入。';
  };

  const updateOcrMeta = (file, source = '') => {
    if (!ocrMeta) return;
    if (!file && ocrStatusMode === 'idle') {
      renderIdleOCRHint();
      ocrPasteZone?.classList.remove('has-file');
      return;
    }

    if (!file) {
      ocrPasteZone?.classList.remove('has-file');
      return;
    }

    const sourceLabel = source ? ` · ${source}` : '';
    ocrMeta.textContent = `已选截图：${file.name || 'ocr-image.png'}${sourceLabel}`;
    ocrPasteZone?.classList.add('has-file');
  };

  const assignOcrImage = (file, source = '') => {
    if (!file) return false;
    if (!String(file.type || '').startsWith('image/')) {
      showToast('截图导入仅支持图片文件', 'warning');
      return false;
    }

    selectedOcrImage = file;
    ocrStatusMode = 'selected';
    updateOcrMeta(file, source);
    return true;
  };

  const extractImageFromClipboard = (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    for (const item of items) {
      if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
        return item.getAsFile();
      }
    }

    const files = Array.from(event.clipboardData?.files || []);
    return files.find(file => String(file.type || '').startsWith('image/')) || null;
  };

  container.querySelector('#btnAddWeek')?.addEventListener('click', async () => {
    const num = parseInt(container.querySelector('#newWeekNum')?.value, 10);
    const label = container.querySelector('#newWeekLabel')?.value.trim();
    if (!num || num < 1) {
      showToast('请输入有效周次编号', 'error');
      return;
    }
    try {
      await upsertWeek(num, label || `第${num}周`);
      showToast('周次已添加');
      window._router?.replace('/import');
    } catch (err) {
      showToast(`添加失败：${err.message}`, 'error');
    }
  });

  container.querySelector('#btnImport')?.addEventListener('click', async () => {
    const weekId = Number(container.querySelector('#selectWeek')?.value);
    const wordType = container.querySelector('#selectWordType')?.value;
    const raw = wordDataInput?.value.trim();

    if (!weekId) return showToast('请先选择周次', 'error');
    if (!raw) return showToast('请输入单词数据', 'error');

    const wordList = parseWordText(raw, weekId, wordType);
    if (!wordList.length) return showToast('未解析到有效单词', 'error');

    showLoading(true);
    try {
      const ids = await addWords(wordList);
      showLoading(false);
      showToast(`成功导入 ${ids.length} 个单词`);
      if (wordDataInput) wordDataInput.value = '';
    } catch (err) {
      showLoading(false);
      showToast(`导入失败：${err.message}`, 'error');
    }
  });

  container.querySelector('#btnExport')?.addEventListener('click', async () => {
    showLoading(true);
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ket-vocab-backup-${getTodayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showLoading(false);
      showToast('数据已导出');
    } catch (err) {
      showLoading(false);
      showToast(`导出失败：${err.message}`, 'error');
    }
  });

  ocrFileInput?.addEventListener('change', () => {
    const file = ocrFileInput.files?.[0] || null;
    assignOcrImage(file, '本地文件');
  });

  ocrPasteZone?.addEventListener('click', () => ocrFileInput?.focus());
  ocrPasteZone?.addEventListener('paste', (event) => {
    const imageFile = extractImageFromClipboard(event);
    if (!imageFile) {
      showToast('剪贴板里没有图片，请先复制截图后再粘贴', 'warning');
      return;
    }

    event.preventDefault();
    const fileName = imageFile.name || `ocr-${Date.now()}.png`;
    const pastedFile = new File([imageFile], fileName, { type: imageFile.type || 'image/png' });
    assignOcrImage(pastedFile, '剪贴板图片');
    showToast('已粘贴截图，可以开始识别');
  });

  ocrPasteZone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ocrFileInput?.click();
    }
  });

  btnRecognize?.addEventListener('click', async () => {
    if (!selectedOcrImage) {
      showToast('请先选择或粘贴词表截图', 'error');
      return;
    }

    showLoading(true);
    btnRecognize.disabled = true;
    ocrStatusMode = 'recognizing';

    try {
      const rawText = await recognizeWordImage(selectedOcrImage, (message) => {
        if (ocrMeta && message) ocrMeta.textContent = message;
      });

      const parsedText = parseOCRWordText(rawText);
      if (!parsedText) {
        showLoading(false);
        btnRecognize.disabled = false;
        ocrStatusMode = 'selected';
        updateOcrMeta(selectedOcrImage, '已识别但未解析');
        showToast('识别完成，但没有提取到可导入的词条，请手动检查截图内容', 'warning');
        if (wordDataInput && !wordDataInput.value.trim()) {
          wordDataInput.value = rawText.trim();
        }
        return;
      }

      if (wordDataInput) {
        wordDataInput.value = parsedText;
      }
      showLoading(false);
      btnRecognize.disabled = false;
      ocrStatusMode = 'selected';
      updateOcrMeta(selectedOcrImage, '识别完成');
      showToast('截图已识别，结果已填入上方文本框');
    } catch (err) {
      showLoading(false);
      btnRecognize.disabled = false;
      ocrStatusMode = 'selected';
      updateOcrMeta(selectedOcrImage, '可重试');
      showToast(`截图识别失败：${err.message}`, 'error');
    }
  });

  updateOcrMeta(selectedOcrImage);
}

function parseWordText(text, weekId, wordType) {
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split(',').map(item => item.trim()))
    .filter(parts => parts.length >= 2)
    .filter(parts => !['english', 'word', '英文'].includes(parts[0].toLowerCase()))
    .map(parts => ({
      english: parts[0].toLowerCase(),
      chinese: parts[1],
      part_of_speech: parts[2] || '',
      word_type: wordType,
      week_id: weekId,
    }))
    .filter(item => item.english && item.chinese);
}

let _tesseractLoader = null;
let _ocrWorkerPromise = null;
let _ocrProgressHandler = null;

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  if (_tesseractLoader) return _tesseractLoader;

  _tesseractLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = OCR_SCRIPT_PATH;
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error('OCR 脚本加载成功，但 Tesseract 未挂载'));
    };
    script.onerror = () => reject(new Error('OCR 脚本加载失败，请检查本地 OCR 资源是否完整'));
    document.head.appendChild(script);
  });
  try {
    return await _tesseractLoader;
  } catch (err) {
    _tesseractLoader = null;
    throw err;
  }
}

async function getOCRWorker(onProgress) {
  _ocrProgressHandler = typeof onProgress === 'function' ? onProgress : null;
  if (_ocrWorkerPromise) return _ocrWorkerPromise;

  _ocrWorkerPromise = (async () => {
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker('eng+chi_sim', 1, {
      workerPath: OCR_WORKER_PATH,
      corePath: OCR_CORE_PATH,
      langPath: OCR_LANG_PATH,
      gzip: true,
      logger: (info) => {
        if (typeof _ocrProgressHandler !== 'function') return;
        if (info.status === 'recognizing text') {
          const pct = Math.round((info.progress || 0) * 100);
          _ocrProgressHandler(`正在识别截图… ${pct}%`);
        } else if (info.status) {
          _ocrProgressHandler(`正在准备识别… ${info.status}`);
        }
      },
    });
    return worker;
  })();

  try {
    return await _ocrWorkerPromise;
  } catch (err) {
    _ocrWorkerPromise = null;
    throw err;
  }
}

async function recognizeWordImage(file, onProgress) {
  const worker = await getOCRWorker(onProgress);
  const imageUrl = URL.createObjectURL(file);

  try {
    const result = await worker.recognize(imageUrl, {
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    return result?.data?.text || '';
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function parseOCRWordText(rawText) {
  const normalizedLines = String(rawText || '')
    .replace(/[，；]/g, ',')
    .replace(/[|]/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const parsedRows = [];

  for (const line of normalizedLines) {
    const cleanLine = line
      .replace(/^\d+[\.\)、]\s*/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleanLine) continue;

    const csvParts = cleanLine.split(',').map(item => item.trim()).filter(Boolean);
    if (csvParts.length >= 2 && hasLatin(csvParts[0]) && hasChinese(csvParts[1])) {
      parsedRows.push([
        normalizeEnglish(csvParts[0]),
        csvParts[1],
        csvParts[2] || '',
      ].filter(Boolean).join(','));
      continue;
    }

    const englishMatch = cleanLine.match(/[A-Za-z][A-Za-z\-'\s]{0,40}/);
    if (!englishMatch) continue;

    const english = normalizeEnglish(englishMatch[0]);
    const rest = cleanLine.slice(englishMatch.index + englishMatch[0].length).trim();
    if (!english || !hasChinese(rest)) continue;

    const posMatch = rest.match(/\b(n|v|adj|adv|prep|pron|num|conj|int)\.?\b/i);
    const pos = posMatch ? posMatch[0] : '';
    const chinese = rest.replace(/\b(n|v|adj|adv|prep|pron|num|conj|int)\.?\b/ig, '').trim();
    if (!chinese) continue;

    parsedRows.push([english, chinese, pos].filter(Boolean).join(','));
  }

  return dedupeLines(parsedRows).join('\n');
}

function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter(line => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeEnglish(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-zA-Z\-' ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasLatin(text) {
  return /[A-Za-z]/.test(String(text || ''));
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function createReviewDraft(task, ocrText = '') {
  const basic = [
    ...task.sections.basic.left.map(row => createBasicDraftRow(row, 'left', ocrText)),
    ...task.sections.basic.right.map(row => createBasicDraftRow(row, 'right', ocrText)),
  ];
  const extended = [
    ...task.sections.extended.left.map(row => createExtendedDraftRow(row, 'left')),
    ...task.sections.extended.right.map(row => createExtendedDraftRow(row, 'right')),
  ];

  return judgeReviewDraft({
    basic,
    extended,
    ocrText: String(ocrText || '').trim(),
    generatedAt: new Date().toISOString(),
  });
}

function createBasicDraftRow(row, column, ocrText) {
  const expected = row.direction === 'cn_to_en' ? row.answer : row.answer;
  return {
    id: `basic-${column}-${row.seq}`,
    column,
    seq: row.seq,
    prompt: row.prompt,
    expected,
    direction: row.direction,
    wordId: row.wordId,
    studentAnswer: guessBasicAnswerFromOCR(row, ocrText),
    verdict: 'pending',
    source: ocrText ? 'ocr' : 'manual',
  };
}

function createExtendedDraftRow(row, column) {
  return {
    id: `extended-${column}-${row.seq}`,
    column,
    seq: row.seq,
    english: row.english,
    chinese: row.chinese,
    wordId: row.wordId,
    mark: 'pending',
    note: '',
  };
}

function guessBasicAnswerFromOCR(row, ocrText) {
  const raw = String(ocrText || '');
  if (!raw) return '';

  if (row.direction === 'cn_to_en') {
    const tokens = raw
      .toLowerCase()
      .split(/[^a-zA-Z'-]+/)
      .map(token => token.trim())
      .filter(Boolean);
    const expected = normalizeEnglish(row.answer);
    if (!expected) return '';
    if (tokens.includes(expected)) return row.answer;

    let best = '';
    let bestDistance = Infinity;
    for (const token of tokens) {
      if (Math.abs(token.length - expected.length) > 2) continue;
      const distance = levenshtein(token, expected);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = token;
      }
    }
    return bestDistance <= 1 ? best : '';
  }

  const normalizedOCR = normalizeChineseText(raw);
  const expected = normalizeChineseText(row.answer);
  return expected && normalizedOCR.includes(expected) ? row.answer : '';
}

function levenshtein(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i++) dp[i][0] = i;
  for (let j = 0; j <= right.length; j++) dp[0][j] = j;

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function normalizeChineseText(text) {
  return String(text || '')
    .replace(/[，。！？；：、\s]/g, '')
    .trim();
}

function normalizeReviewDraft(task) {
  const draft = task.review_draft;
  if (!draft?.basic || !draft?.extended) {
    return createReviewDraft(task, task.ocr_text || '');
  }
  return judgeReviewDraft({
    ...draft,
    basic: draft.basic.map(item => ({ ...item })),
    extended: draft.extended.map(item => ({ ...item })),
  });
}

function judgeReviewDraft(draft) {
  const next = {
    ...draft,
    basic: (draft.basic || []).map(item => ({
      ...item,
      verdict: judgeBasicAnswer(item.studentAnswer, item.expected, item.direction),
    })),
    extended: (draft.extended || []).map(item => ({
      ...item,
      mark: ['correct', 'wrong', 'pending'].includes(item.mark) ? item.mark : 'pending',
    })),
  };
  next.summary = summarizeReviewDraft(next);
  return next;
}

function judgeBasicAnswer(studentAnswer, expected, direction) {
  const answer = String(studentAnswer || '').trim();
  if (!answer) return 'pending';

  if (direction === 'cn_to_en') {
    return normalizeEnglish(answer) === normalizeEnglish(expected) ? 'correct' : 'wrong';
  }

  return normalizeChineseText(answer) === normalizeChineseText(expected) ? 'correct' : 'wrong';
}

function summarizeReviewDraft(draft) {
  const basicCorrect = draft.basic.filter(item => item.verdict === 'correct').length;
  const basicWrong = draft.basic.filter(item => item.verdict === 'wrong').length;
  const basicPending = draft.basic.filter(item => item.verdict === 'pending').length;
  const extendedCorrect = draft.extended.filter(item => item.mark === 'correct').length;
  const extendedWrong = draft.extended.filter(item => item.mark === 'wrong').length;
  const extendedPending = draft.extended.filter(item => item.mark === 'pending').length;

  return {
    basicCorrect,
    basicWrong,
    basicPending,
    extendedCorrect,
    extendedWrong,
    extendedPending,
    totalCorrect: basicCorrect + extendedCorrect,
    totalWrong: basicWrong + extendedWrong,
    totalPending: basicPending + extendedPending,
  };
}

function renderReviewSummary(summary) {
  return `
    <div class="review-summary-grid">
      <div class="review-summary-card">
        <strong>${summary.totalCorrect}</strong>
        <span>已判正确</span>
      </div>
      <div class="review-summary-card">
        <strong>${summary.totalWrong}</strong>
        <span>已判错误</span>
      </div>
      <div class="review-summary-card">
        <strong>${summary.totalPending}</strong>
        <span>待处理</span>
      </div>
    </div>
  `;
}

function renderVerdictPill(verdict) {
  const labelMap = {
    correct: '正确',
    wrong: '错误',
    pending: '待判定',
  };
  return `<span class="review-pill review-pill-${verdict}">${labelMap[verdict] || '待判定'}</span>`;
}

function renderGradingWorkspace(task, draft, locked = false) {
  const leftBasic = draft.basic.filter(item => item.column === 'left');
  const rightBasic = draft.basic.filter(item => item.column === 'right');
  const leftExtended = draft.extended.filter(item => item.column === 'left');
  const rightExtended = draft.extended.filter(item => item.column === 'right');

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">复核工作区</div>
          <h3>逐题确认后再提交结果</h3>
        </div>
        <span class="status-pill">${locked ? '已写入进度' : '草稿可编辑'}</span>
      </div>
      ${renderReviewSummary(draft.summary)}
      <div class="task-toolbar">
        ${locked ? '' : '<button class="btn btn-secondary" id="btnSaveReviewDraft">保存复核草稿</button>'}
        ${locked ? '' : '<button class="btn btn-primary" id="btnApplyGrading">完成批改并更新进度</button>'}
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">基础词自动判定</div>
          <h3>输入学生答案，系统自动判对错</h3>
        </div>
      </div>
      <div class="review-grid">
        ${renderBasicReviewTable('左列：中文写英文', leftBasic, locked)}
        ${renderBasicReviewTable('右列：英文写中文', rightBasic, locked)}
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">拓展词人工校对</div>
          <h3>根据图片勾叉逐条确认</h3>
        </div>
      </div>
      <div class="review-grid">
        ${renderExtendedReviewTable('左列拓展词', leftExtended, locked)}
        ${renderExtendedReviewTable('右列拓展词', rightExtended, locked)}
      </div>
    </section>

    ${task.ocr_text ? `
      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">OCR 原始结果</div>
            <h3>识别文本参考</h3>
          </div>
        </div>
        <textarea class="form-textarea grading-ocr-text" readonly>${esc(task.ocr_text)}</textarea>
      </section>
    ` : ''}
  `;
}

function renderBasicReviewTable(title, rows, locked) {
  return `
    <div class="sheet-table-wrap">
      <div class="mini-title">${esc(title)}</div>
      <div class="table-shell">
        <table class="data-table review-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>题目</th>
              <th>学生答案</th>
              <th>标准答案</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(item => `
              <tr>
                <td>${item.seq}</td>
                <td>${esc(item.prompt)}</td>
                <td>
                  <input
                    type="text"
                    class="form-input review-answer-input"
                    data-review-kind="basic"
                    data-review-id="${esc(item.id)}"
                    value="${esc(item.studentAnswer || '')}"
                    ${locked ? 'disabled' : ''}
                  />
                </td>
                <td>${esc(item.expected)}</td>
                <td>${renderVerdictPill(item.verdict)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderExtendedReviewTable(title, rows, locked) {
  return `
    <div class="sheet-table-wrap">
      <div class="mini-title">${esc(title)}</div>
      <div class="table-shell">
        <table class="data-table review-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>单词</th>
              <th>中文释义</th>
              <th>批改结果</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(item => `
              <tr>
                <td>${item.seq}</td>
                <td>${esc(item.english)}</td>
                <td>${esc(item.chinese)}</td>
                <td>
                  <select
                    class="form-select review-mark-select"
                    data-review-kind="extended"
                    data-review-id="${esc(item.id)}"
                    ${locked ? 'disabled' : ''}
                  >
                    <option value="pending" ${item.mark === 'pending' ? 'selected' : ''}>待判断</option>
                    <option value="correct" ${item.mark === 'correct' ? 'selected' : ''}>正确</option>
                    <option value="wrong" ${item.mark === 'wrong' ? 'selected' : ''}>错误</option>
                  </select>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function collectReviewDraft(container, task, draft) {
  const next = {
    ...draft,
    basic: draft.basic.map(item => ({ ...item })),
    extended: draft.extended.map(item => ({ ...item })),
  };

  container.querySelectorAll('[data-review-kind="basic"]').forEach(input => {
    const row = next.basic.find(item => item.id === input.dataset.reviewId);
    if (!row) return;
    row.studentAnswer = input.value.trim();
    row.source = row.studentAnswer ? 'manual' : row.source;
  });

  container.querySelectorAll('[data-review-kind="extended"]').forEach(select => {
    const row = next.extended.find(item => item.id === select.dataset.reviewId);
    if (!row) return;
    row.mark = select.value;
  });

  return judgeReviewDraft(next);
}

async function applyReviewResults(task, draft) {
  const finalDraft = judgeReviewDraft(draft);
  for (const item of finalDraft.basic) {
    await updateProgress(item.wordId, item.verdict === 'correct' ? 'correct' : 'wrong', task.date);
  }
  for (const item of finalDraft.extended) {
    await updateProgress(item.wordId, item.mark === 'correct' ? 'correct' : 'wrong', task.date);
  }
  return finalDraft;
}

async function renderGrading(container) {
  setHeaderTitle('上传与批改');
  setBackBtn(false);
  container.innerHTML = renderLoading();

  try {
    const task = await getDailyTask(getTodayStr());
    if (!task?.sections) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">还没有今日任务单</div>
          <div class="empty-state-desc">先生成任务单并打印，才能进入拍照上传与批改流程。</div>
          <button class="btn btn-primary" id="btnGoTasks">前往任务单</button>
        </div>
      `;
      container.querySelector('#btnGoTasks')?.addEventListener('click', () => window._router?.go('/tasks'));
      return;
    }

    const uploadedBlob = task.uploaded_image_blob || null;
    const uploadedPreview = uploadedBlob ? URL.createObjectURL(uploadedBlob) : '';
    const reviewDraft = task.review_draft ? normalizeReviewDraft(task) : null;
    const gradingLocked = !!task.grading_applied_at;

    container.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">${esc(task.date)}</div>
            <h3>拍照上传与复核</h3>
          </div>
          <span class="status-pill">${esc(taskStatusLabel(task.status))}</span>
        </div>
        <div class="status-track">
          ${renderStatusStep('已打印', ['printed', 'uploaded', 'reviewing', 'completed'].includes(task.status))}
          ${renderStatusStep('已上传', ['uploaded', 'reviewing', 'completed'].includes(task.status))}
          ${renderStatusStep('待复核', ['reviewing', 'completed'].includes(task.status))}
          ${renderStatusStep('已完成', task.status === 'completed')}
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">基础词自动批改 + 拓展词人工校对</div>
            <h3>上传任务单并生成复核草稿</h3>
          </div>
        </div>
        <p class="section-desc">先上传或粘贴任务单图片，再选择“OCR 识别生成草稿”或“人工复核草稿”。基础词会根据你填写的学生答案自动判对错，拓展词用人工勾选结果，最后统一写回单词进度。</p>
        <div class="form-group">
          <label class="form-label">上传任务单照片</label>
          <div class="paste-upload" id="gradingPasteZone" tabindex="0" role="button" aria-label="上传任务单照片，支持选择文件或直接粘贴图片">
            <input type="file" class="form-input" id="gradingFile" accept="image/*" />
            <div class="paste-upload-meta" id="gradingUploadMeta">
              ${uploadedBlob
                ? `已上传图片：${esc(task.uploaded_filename || 'task-image.png')}`
                : '支持选择图片文件，也支持在这里直接粘贴截图'}
            </div>
          </div>
        </div>
        ${uploadedPreview ? `
          <div class="grading-image-preview">
            <img src="${uploadedPreview}" alt="任务单预览" class="grading-preview-image" />
          </div>
        ` : ''}
        <div class="task-toolbar">
          <button class="btn btn-secondary" id="btnSaveUpload" ${gradingLocked ? 'disabled' : ''}>保存上传图片</button>
          <button class="btn btn-primary" id="btnRunSheetOCR" ${gradingLocked ? 'disabled' : ''}>OCR 识别生成草稿</button>
          <button class="btn btn-ghost" id="btnCreateManualDraft" ${gradingLocked ? 'disabled' : ''}>生成人工复核草稿</button>
        </div>
      </section>

      <section class="panel panel-list">
        <div class="section-head">
          <div>
            <div class="section-kicker">任务单内容摘要</div>
            <h3>用于后续 OCR / 人工复核</h3>
          </div>
        </div>
        <div class="list-row">
          <div>
            <div class="list-title">基础词汇</div>
            <div class="list-meta">${task.summary.basicCount} 个，系统根据你输入的学生答案自动判对错</div>
          </div>
          <span class="status-pill">自动判定</span>
        </div>
        <div class="list-row">
          <div>
            <div class="list-title">拓展词汇</div>
            <div class="list-meta">${task.summary.extendedCount} 个，逐条选择正确 / 错误</div>
          </div>
          <span class="status-pill">人工校对</span>
        </div>
        ${task.grading_summary ? `
          <div class="list-row">
            <div>
              <div class="list-title">最近一次批改结果</div>
              <div class="list-meta">正确 ${task.grading_summary.totalCorrect} · 错误 ${task.grading_summary.totalWrong} · 待处理 ${task.grading_summary.totalPending}</div>
            </div>
            <span class="status-pill">${task.grading_applied_at ? '已写入' : '草稿中'}</span>
          </div>
        ` : ''}
      </section>

      ${reviewDraft ? renderGradingWorkspace(task, reviewDraft, gradingLocked) : ''}
    `;

    const fileInput = container.querySelector('#gradingFile');
    const pasteZone = container.querySelector('#gradingPasteZone');
    const uploadMeta = container.querySelector('#gradingUploadMeta');
    let selectedUploadFile = fileInput?.files?.[0] || null;

    const updateUploadMeta = (file, source = '') => {
      if (!uploadMeta) return;
      if (!file) {
        uploadMeta.textContent = uploadedBlob
          ? `已上传图片：${task.uploaded_filename || 'task-image.png'}`
          : '支持选择图片文件，也支持在这里直接粘贴截图';
        pasteZone?.classList.remove('has-file');
        return;
      }

      const sourceLabel = source ? ` · ${source}` : '';
      uploadMeta.textContent = `已选图片：${file.name || 'clipboard-image.png'}${sourceLabel}`;
      pasteZone?.classList.add('has-file');
    };

    const assignSelectedFile = (file, source = '') => {
      if (!file) return false;
      if (!String(file.type || '').startsWith('image/')) {
        showToast('仅支持图片文件', 'warning');
        return false;
      }

      selectedUploadFile = file;
      updateUploadMeta(file, source);
      return true;
    };

    const extractImageFromClipboard = (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      for (const item of items) {
        if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
          return item.getAsFile();
        }
      }

      const files = Array.from(event.clipboardData?.files || []);
      return files.find(file => String(file.type || '').startsWith('image/')) || null;
    };

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0] || null;
      selectedUploadFile = file;
      updateUploadMeta(file, '本地文件');
    });

    pasteZone?.addEventListener('click', () => fileInput?.focus());
    pasteZone?.addEventListener('paste', (event) => {
      const imageFile = extractImageFromClipboard(event);
      if (!imageFile) {
        showToast('剪贴板里没有图片，请先复制截图后再粘贴', 'warning');
        return;
      }

      event.preventDefault();
      const fileName = imageFile.name || `clipboard-${Date.now()}.png`;
      const pastedFile = new File([imageFile], fileName, { type: imageFile.type || 'image/png' });
      assignSelectedFile(pastedFile, '剪贴板图片');
      showToast('已粘贴图片，可继续标记上传');
    });

    pasteZone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });

    updateUploadMeta(selectedUploadFile);

    const persistUploadedImage = async () => {
      const file = selectedUploadFile || uploadedBlob;
      if (!file) {
        showToast('请先选择或粘贴任务单图片', 'error');
        return null;
      }

      const patch = {
        status: 'uploaded',
        uploaded_filename: selectedUploadFile?.name || task.uploaded_filename || 'task-image.png',
        uploaded_at: new Date().toISOString(),
      };

      if (selectedUploadFile) {
        patch.uploaded_image_blob = selectedUploadFile;
      }

      const nextTask = await updateDailyTask(task.date, patch);
      return {
        ...task,
        ...nextTask,
        uploaded_image_blob: patch.uploaded_image_blob || uploadedBlob,
      };
    };

    container.querySelector('#btnSaveUpload')?.addEventListener('click', async () => {
      showLoading(true);
      try {
        const nextTask = await persistUploadedImage();
        showLoading(false);
        if (!nextTask) return;
        showToast('图片已保存，可以继续 OCR 或人工复核');
        await renderGrading(container);
      } catch (err) {
        showLoading(false);
        showToast(`保存上传图片失败：${err.message}`, 'error');
      }
    });

    container.querySelector('#btnRunSheetOCR')?.addEventListener('click', async () => {
      showLoading(true);
      try {
        const nextTask = await persistUploadedImage();
        if (!nextTask?.uploaded_image_blob) {
          showLoading(false);
          return;
        }

        const ocrText = await recognizeWordImage(nextTask.uploaded_image_blob, (message) => {
          if (uploadMeta && message) uploadMeta.textContent = message;
        });
        const draft = createReviewDraft(nextTask, ocrText);

        await updateDailyTask(task.date, {
          status: 'reviewing',
          reviewing_at: new Date().toISOString(),
          ocr_text: ocrText,
          ocr_at: new Date().toISOString(),
          review_draft: draft,
          grading_summary: draft.summary,
        });
        showLoading(false);
        showToast('OCR 完成，已生成复核草稿');
        await renderGrading(container);
      } catch (err) {
        showLoading(false);
        showToast(`OCR 失败：${err.message}`, 'error');
        updateUploadMeta(selectedUploadFile, '可重试');
      }
    });

    container.querySelector('#btnCreateManualDraft')?.addEventListener('click', async () => {
      showLoading(true);
      try {
        const nextTask = await persistUploadedImage();
        if (!nextTask?.uploaded_image_blob) {
          showLoading(false);
          return;
        }

        const draft = createReviewDraft(nextTask, '');
        await updateDailyTask(task.date, {
          status: 'reviewing',
          reviewing_at: new Date().toISOString(),
          review_draft: draft,
          grading_summary: draft.summary,
        });
        showLoading(false);
        showToast('已生成人工复核草稿');
        await renderGrading(container);
      } catch (err) {
        showLoading(false);
        showToast(`生成草稿失败：${err.message}`, 'error');
      }
    });

    if (reviewDraft && !gradingLocked) {
      container.querySelector('#btnSaveReviewDraft')?.addEventListener('click', async () => {
        const nextDraft = collectReviewDraft(container, task, reviewDraft);
        await updateDailyTask(task.date, {
          status: 'reviewing',
          reviewing_at: new Date().toISOString(),
          review_draft: nextDraft,
          grading_summary: nextDraft.summary,
        });
        showToast('复核草稿已保存');
        await renderGrading(container);
      });

      container.querySelector('#btnApplyGrading')?.addEventListener('click', async () => {
        const nextDraft = collectReviewDraft(container, task, reviewDraft);
        if (nextDraft.summary.totalPending > 0) {
          showToast(`还有 ${nextDraft.summary.totalPending} 项待处理，不能直接完成批改`, 'error');
          return;
        }

        showLoading(true);
        try {
          const appliedDraft = await applyReviewResults(task, nextDraft);
          await updateDailyTask(task.date, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            review_draft: appliedDraft,
            grading_summary: appliedDraft.summary,
            grading_applied_at: new Date().toISOString(),
          });
          showLoading(false);
          showToast('批改已完成，复习进度已更新');
          await renderGrading(container);
        } catch (err) {
          showLoading(false);
          showToast(`提交批改失败：${err.message}`, 'error');
        }
      });
    }

  } catch (err) {
    container.innerHTML = renderError(err.message);
  }
}

async function renderStatsPage(container) {
  setHeaderTitle('复习统计');
  setBackBtn(false);
  await initStats(container);
}

async function renderSettings(container) {
  setHeaderTitle('设置');
  setBackBtn(false);

  const settings = loadSettings();
  container.innerHTML = `
    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">固定预算</div>
          <h3>每日任务量</h3>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">基础词汇每日数量</label>
          <input type="number" class="form-input" id="basicDailyCount" value="${settings.basicDailyCount}" min="2" max="40" />
        </div>
        <div class="form-group">
          <label class="form-label">拓展词汇每日数量</label>
          <input type="number" class="form-input" id="extendedDailyCount" value="${settings.extendedDailyCount}" min="4" max="60" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">提醒时间</label>
        <input type="time" class="form-input" id="reminderTime" value="${esc(settings.reminderTime)}" />
      </div>
      <div class="toggle-row">
        <label class="toggle">
          <input type="checkbox" id="enableLowFrequencyCheck" ${settings.enableLowFrequencyCheck ? 'checked' : ''} />
          <span class="toggle-track"></span>
        </label>
        <span>开启低频抽查</span>
      </div>
      <div class="toggle-row">
        <label class="toggle">
          <input type="checkbox" id="enableEnterpriseWechat" ${settings.enableEnterpriseWechat ? 'checked' : ''} />
          <span class="toggle-track"></span>
        </label>
        <span>预留企业微信发送开关（P1）</span>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">默认复习曲线</div>
          <h3>推荐参数，可后续接入更高级算法</h3>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">基础词汇间隔（天，逗号分隔）</label>
        <input type="text" class="form-input" id="basicIntervals" value="${settings.basicIntervals.join(', ')}" />
      </div>
      <div class="form-group">
        <label class="form-label">拓展词汇间隔（天，逗号分隔）</label>
        <input type="text" class="form-input" id="extendedIntervals" value="${settings.extendedIntervals.join(', ')}" />
      </div>
      <div class="form-group">
        <label class="form-label">界面主题</label>
        <select class="form-select" id="themeMode">
          <option value="system" ${loadThemePreference() === 'system' ? 'selected' : ''}>跟随系统</option>
          <option value="light" ${loadThemePreference() === 'light' ? 'selected' : ''}>浅色</option>
          <option value="dark" ${loadThemePreference() === 'dark' ? 'selected' : ''}>深色</option>
        </select>
      </div>
      <button class="btn btn-primary btn-full" id="btnSaveSettings">保存设置</button>
    </section>
  `;

  container.querySelector('#btnSaveSettings')?.addEventListener('click', () => {
    const basicDailyCount = parseInt(container.querySelector('#basicDailyCount')?.value, 10);
    const extendedDailyCount = parseInt(container.querySelector('#extendedDailyCount')?.value, 10);
    if (!basicDailyCount || !extendedDailyCount) {
      showToast('请输入有效的每日任务量', 'error');
      return;
    }

    saveSettings({
      basicDailyCount,
      extendedDailyCount,
      reminderTime: container.querySelector('#reminderTime')?.value || '07:30',
      enableLowFrequencyCheck: !!container.querySelector('#enableLowFrequencyCheck')?.checked,
      enableEnterpriseWechat: !!container.querySelector('#enableEnterpriseWechat')?.checked,
      basicIntervals: parseIntervals(container.querySelector('#basicIntervals')?.value),
      extendedIntervals: parseIntervals(container.querySelector('#extendedIntervals')?.value),
    });
    saveThemePreference(container.querySelector('#themeMode')?.value || 'system');
    showToast('设置已保存');
  });
}

function renderTaskSheet(task) {
  return `
    <article class="sheet-card">
      <header class="sheet-header">
        <div>
          <div class="sheet-title">KET 今日任务单</div>
          <div class="sheet-meta">${esc(task.date)} · 基础词汇 ${task.summary.basicCount} 个 · 拓展词汇 ${task.summary.extendedCount} 个</div>
        </div>
      </header>

      <div class="sheet-section">
        <div class="sheet-section-title">基础词汇</div>
        <div class="task-columns">
          ${renderBasicTable(task.sections.basic.left, '左列：中文写英文', '中文释义', '单词')}
          ${renderBasicTable(task.sections.basic.right, '右列：英文写中文', '单词', '中文释义')}
        </div>
      </div>

      <div class="sheet-section">
        <div class="sheet-section-title">拓展词汇</div>
        <div class="task-columns">
          ${renderExtendedTable(task.sections.extended.left)}
          ${renderExtendedTable(task.sections.extended.right)}
        </div>
      </div>
    </article>
  `;
}

function renderBasicTable(rows, title, colA, colB) {
  return `
    <div class="sheet-table-wrap">
      <div class="mini-title">${esc(title)}</div>
      <table class="sheet-table">
        <thead><tr><th>序号</th><th>${esc(colA)}</th><th>${esc(colB)}</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(row => `
            <tr>
              <td>${row.seq}</td>
              <td>${esc(row.prompt)}</td>
              <td class="answer-cell"></td>
            </tr>
          `).join('') : '<tr><td colspan="3" class="empty-cell">暂无内容</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderExtendedTable(rows) {
  return `
    <div class="sheet-table-wrap">
      <div class="mini-title">左右各三列表格 + 批改列</div>
      <table class="sheet-table">
        <thead><tr><th>序号</th><th>单词</th><th>中文释义</th><th>批改</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(row => `
            <tr>
              <td>${row.seq}</td>
              <td>${esc(row.english)}</td>
              <td>${esc(row.chinese)}</td>
              <td class="mark-cell"></td>
            </tr>
          `).join('') : '<tr><td colspan="4" class="empty-cell">暂无内容</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function openPrintView(task) {
  const printableHtml = buildPrintableTaskDocument(task);

  try {
    const printedFromPopup = await openPrintPopup(printableHtml);
    if (printedFromPopup) return true;
  } catch (err) {
    console.warn('[print] popup flow failed:', err);
  }

  try {
    return await openPrintFrame(printableHtml);
  } catch (err) {
    console.warn('[print] iframe flow failed:', err);
    showToast('无法打开打印窗口，请检查浏览器是否阻止了打印或弹窗', 'error');
    return false;
  }
}

function buildPrintableTaskDocument(task) {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>KET 今日任务单 ${task.date}</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        html, body { background: #ffffff; }
        body { font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif; margin: 0; color: #111827; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        p { margin: 0 0 20px; color: #4b5563; }
        .section { margin-bottom: 28px; break-inside: avoid; page-break-inside: avoid; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; vertical-align: top; word-break: break-word; }
        th { background: #f8fafc; }
        td.blank { height: 32px; }
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <h1>KET 今日任务单</h1>
      <p>${task.date} · 基础词汇 ${task.summary.basicCount} 个 · 拓展词汇 ${task.summary.extendedCount} 个</p>
      ${renderPrintableTaskSheet(task)}
    </body>
    </html>
  `;
}

function openPrintPopup(printableHtml) {
  return new Promise((resolve, reject) => {
    const win = window.open('', '_blank');
    if (!win) {
      reject(new Error('popup_blocked'));
      return;
    }

    let settled = false;
    const finalize = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    win.document.open();
    win.document.write(printableHtml);
    win.document.close();

    const triggerPrint = () => {
      try {
        win.focus();
        window.setTimeout(() => {
          try {
            win.print();
            finalize(true);
          } catch (err) {
            reject(err);
          }
        }, 250);
      } catch (err) {
        reject(err);
      }
    };

    if (win.document.readyState === 'complete') {
      triggerPrint();
      return;
    }

    win.addEventListener('load', triggerPrint, { once: true });
    window.setTimeout(() => triggerPrint(), 700);
  });
}

function openPrintFrame(printableHtml) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');

    let finished = false;
    const cleanup = () => {
      window.setTimeout(() => iframe.remove(), 1000);
    };
    const finalize = (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(result);
    };

    iframe.onload = () => {
      try {
        const frameWindow = iframe.contentWindow;
        if (!frameWindow) throw new Error('missing_iframe_window');

        window.setTimeout(() => {
          try {
            frameWindow.focus();
            frameWindow.print();
            finalize(true);
          } catch (err) {
            reject(err);
          }
        }, 250);
      } catch (err) {
        reject(err);
      }
    };

    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      reject(new Error('missing_iframe_document'));
      return;
    }

    doc.open();
    doc.write(printableHtml);
    doc.close();

    window.setTimeout(() => {
      if (!finished) finalize(true);
    }, 1200);
  });
}

function renderPrintableTaskSheet(task) {
  const basicLeftRows = task.sections.basic.left.map(row => `<tr><td>${row.seq}</td><td>${esc(row.prompt)}</td><td class="blank"></td></tr>`).join('');
  const basicRightRows = task.sections.basic.right.map(row => `<tr><td>${row.seq}</td><td>${esc(row.prompt)}</td><td class="blank"></td></tr>`).join('');
  const extendedLeftRows = task.sections.extended.left.map(row => `<tr><td>${row.seq}</td><td>${esc(row.english)}</td><td>${esc(row.chinese)}</td><td class="blank"></td></tr>`).join('');
  const extendedRightRows = task.sections.extended.right.map(row => `<tr><td>${row.seq}</td><td>${esc(row.english)}</td><td>${esc(row.chinese)}</td><td class="blank"></td></tr>`).join('');

  return `
    <div class="section">
      <strong>基础词汇</strong>
      <div class="grid">
        <table><thead><tr><th>序号</th><th>中文释义</th><th>单词</th></tr></thead><tbody>${basicLeftRows || '<tr><td colspan="3">暂无内容</td></tr>'}</tbody></table>
        <table><thead><tr><th>序号</th><th>单词</th><th>中文释义</th></tr></thead><tbody>${basicRightRows || '<tr><td colspan="3">暂无内容</td></tr>'}</tbody></table>
      </div>
    </div>
    <div class="section">
      <strong>拓展词汇</strong>
      <div class="grid">
        <table><thead><tr><th>序号</th><th>单词</th><th>中文释义</th><th>批改</th></tr></thead><tbody>${extendedLeftRows || '<tr><td colspan="4">暂无内容</td></tr>'}</tbody></table>
        <table><thead><tr><th>序号</th><th>单词</th><th>中文释义</th><th>批改</th></tr></thead><tbody>${extendedRightRows || '<tr><td colspan="4">暂无内容</td></tr>'}</tbody></table>
      </div>
    </div>
  `;
}

function renderStatsPageLink(label, desc, route) {
  return `<button class="quick-card" data-quick-route="${route}"><strong>${esc(label)}</strong><span>${esc(desc)}</span></button>`;
}

function quickActionButton(label, desc, route) {
  return `<button class="quick-card" data-quick-route="${route}"><strong>${esc(label)}</strong><span>${esc(desc)}</span></button>`;
}

function renderStatusStep(label, active) {
  return `<div class="status-step ${active ? 'active' : ''}"><span></span>${esc(label)}</div>`;
}

function taskStatusLabel(status) {
  switch (status) {
    case 'generated': return '已生成';
    case 'printed': return '已打印';
    case 'uploaded': return '已上传';
    case 'reviewing': return '待复核';
    case 'completed': return '已完成';
    default: return '待生成';
  }
}

function pickLatestWeek(weeks) {
  return [...weeks].sort((a, b) => b.week_number - a.week_number)[0] || null;
}

function parseIntervals(raw) {
  return String(raw || '')
    .split(',')
    .map(item => Number(item.trim()))
    .filter(item => Number.isFinite(item) && item >= 0);
}

function renderMasteryChip(level) {
  const label = level === 'green' ? '绿' : level === 'yellow' ? '黄' : '红';
  return `<span class="mastery-chip mastery-${level}">${label}</span>`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

function setHeaderTitle(title) {
  const el = document.getElementById('headerTitle');
  if (el) el.textContent = title;
}

function setBackBtn(show, route) {
  const btn = document.getElementById('btnBack');
  if (!btn) return;
  if (show) {
    btn.classList.remove('hidden');
    btn.onclick = () => window._router?.go(route || '/');
  } else {
    btn.classList.add('hidden');
    btn.onclick = null;
  }
}

export function showLoading(show) {
  document.getElementById('loadingOverlay')?.classList.toggle('hidden', !show);
}

export function showToast(message, type = 'default', duration = 2400) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? `toast-${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 280);
  }, duration);
}

function showFatalError(msg) {
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100dvh;padding:32px;text-align:center;gap:16px">
      <div style="font-size:48px">⚠️</div>
      <div style="font-size:20px;font-weight:700;color:var(--color-text-primary)">无法启动</div>
      <div style="font-size:14px;color:var(--color-text-secondary);white-space:pre-line">${esc(msg)}</div>
    </div>
  `;
}

function renderLoading() {
  return '<div class="loading-spinner center-spinner"></div>';
}

function renderError(message) {
  return `<div class="empty-state"><div class="empty-state-title">加载失败</div><div class="empty-state-desc">${esc(message)}</div></div>`;
}

function renderEmptyInline(message) {
  return `<div class="empty-inline">${esc(message)}</div>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

main().catch(err => {
  console.error('[App] 启动失败', err);
});
