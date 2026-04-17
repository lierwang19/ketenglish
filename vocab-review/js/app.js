/**
 * vocab-review/js/app.js — 应用入口
 *
 * 职责：
 *   - 初始化 IndexedDB
 *   - 注册 Service Worker
 *   - 启动哈希路由
 *   - 协调各页面模块（home / practice / words / import / errors / stats / settings）
 *   - 全局 Toast、加载遮罩、底部导航高亮
 */

'use strict';

import { createRouter }    from '../../shared/router.js';
import { checkIndexedDBAvailable } from '../../shared/db.js';
import { initDB, getTodayStr, getMasteryStats, getDueWords, getAllWords,
         getAllWeeks, upsertWeek, addWords, deleteWord, getErrorWords,
         clearErrorWord, exportAllData, calcNextReviewDate } from './db.js';
import { buildDailyTask }  from './scheduler.js';
import { initPractice }    from './practice.js';
import { initStats }       from './stats.js';

// ==================== 启动 ====================

async function main() {
  // 1. 检测 IndexedDB 可用性（隐私模式）
  const idbOk = await checkIndexedDBAvailable();
  if (!idbOk) {
    showFatalError('当前浏览器/模式不支持本地存储\n请退出隐私模式后重试');
    return;
  }

  // 2. 初始化数据库
  try {
    await initDB();
  } catch (err) {
    showFatalError(`数据库初始化失败：${err.message}`);
    return;
  }

  // 3. 注册 Service Worker
  registerSW();

  // 4. 绑定底部导航
  bindBottomNav();

  // 5. 启动路由
  const router = createRouter({
    '/':         () => showPage('home',     renderHome),
    '/practice': () => showPage('practice', renderPractice),
    '/words':    () => showPage('words',    renderWords),
    '/import':   () => showPage('import',   renderImport),
    '/errors':   () => showPage('errors',   renderErrors),
    '/stats':    () => showPage('stats',    renderStatsFn),
    '/settings': () => showPage('settings', renderSettings),
  });

  router.start();
  window._router = router; // 方便调试

  // 6. 绑定 SW 更新横幅
  const swBanner  = document.getElementById('swUpdateBanner');
  const btnUpdate = document.getElementById('btnSwUpdate');
  const btnDismiss = document.getElementById('btnSwDismiss');

  btnUpdate?.addEventListener('click', () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  });

  btnDismiss?.addEventListener('click', () => {
    swBanner?.classList.add('hidden');
  });
}

// ==================== Service Worker ====================

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

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATE_AVAILABLE') {
      document.getElementById('swUpdateBanner')?.classList.remove('hidden');
    }
  });
}

// ==================== 路由与页面切换 ====================

const PAGE_MAP = {
  home:     'pageHome',
  practice: 'pagePractice',
  words:    'pageWords',
  import:   'pageImport',
  errors:   'pageErrors',
  stats:    'pageStats',
  settings: 'pageSettings',
};

const NAV_ROUTE_MAP = {
  home:     '/',
  practice: '/practice',
  words:    '/words',
  import:   '/import',
  errors:   '/errors',
  stats:    '/stats',
  settings: '/settings',
};

let _currentPage = null;

async function showPage(pageName, renderFn) {
  // 隐藏所有页面
  Object.values(PAGE_MAP).forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  // 显示目标页面
  const target = document.getElementById(PAGE_MAP[pageName]);
  if (!target) return;

  target.classList.remove('hidden');
  _currentPage = pageName;

  // 底部导航高亮
  updateNavActive(pageName);

  // 渲染页面内容
  if (renderFn) {
    await renderFn(target);
  }
}

// ==================== 底部导航 ====================

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

// ==================== 首页 ====================

async function renderHome(container) {
  setHeaderTitle('KET 单词复习');
  setBackBtn(false);

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const today = getTodayStr();
    const [task, mastery] = await Promise.all([
      buildDailyTask(),
      getMasteryStats(),
    ]);

    const hasTodayTask = task.total > 0;
    const completedAll = task.completed >= task.total && task.total > 0;

    container.innerHTML = `
      <!-- Hero 区域 -->
      <div class="home-hero">
        <div class="hero-number">${task.total - task.completed}</div>
        <div class="hero-label">
          ${completedAll ? '🎉 今日已完成！' : '今日待复习词数'}
        </div>
      </div>

      <!-- 开始复习按钮 -->
      <div style="padding:0 var(--space-4) var(--space-6)">
        ${hasTodayTask && !completedAll
          ? `<button class="btn btn-primary btn-full" id="btnStartReview" style="font-size:var(--font-size-lg);min-height:56px">
               开始今日复习
             </button>`
          : !hasTodayTask
          ? `<button class="btn btn-ghost btn-full" disabled>暂无待复习单词</button>`
          : `<button class="btn btn-secondary btn-full" id="btnStartReview">再练一遍</button>`
        }
      </div>

      <!-- 掌握分布卡 -->
      <div class="card" style="margin:0 0 var(--space-3)">
        <div class="section-title" style="padding-top:0">掌握情况</div>
        <div class="mastery-row">
          <div class="mastery-stat red">
            <div class="mastery-count">${mastery.red}</div>
            <div class="mastery-label">未掌握</div>
          </div>
          <div class="mastery-stat yellow">
            <div class="mastery-count">${mastery.yellow}</div>
            <div class="mastery-label">学习中</div>
          </div>
          <div class="mastery-stat green">
            <div class="mastery-count">${mastery.green}</div>
            <div class="mastery-label">已掌握</div>
          </div>
        </div>
        ${mastery.total > 0 ? `
        <div class="progress-bar" style="margin-top:var(--space-2)">
          <div class="progress-fill fill-green" style="width:${Math.round((mastery.green/mastery.total)*100)}%"></div>
        </div>
        <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:var(--space-1);text-align:right">
          ${mastery.total} 词 · 掌握 ${Math.round((mastery.green/mastery.total)*100)}%
        </div>
        ` : ''}
      </div>

      <!-- 今日分解 -->
      ${task.total > 0 ? `
      <div class="card" style="margin-bottom:var(--space-3)">
        <div class="section-title" style="padding-top:0">今日任务构成</div>
        ${renderTaskBreakdown(task.breakdown)}
      </div>
      ` : ''}

      <!-- 快捷入口 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-4)">
        <button class="card quick-action-btn" data-quick="import">
          <div class="quick-action-icon icon-primary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <div class="quick-action-label">录入单词</div>
        </button>
        <button class="card quick-action-btn" data-quick="errors">
          <div class="quick-action-icon icon-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div class="quick-action-label">错词本</div>
        </button>
      </div>
    `;

    // 绑定事件
    container.querySelector('#btnStartReview')?.addEventListener('click', () => {
      window._router?.go('/practice');
    });

    container.querySelectorAll('[data-quick]').forEach(btn => {
      btn.addEventListener('click', () => {
        window._router?.go('/' + btn.dataset.quick);
      });
    });

  } catch (err) {
    console.error('[Home] 渲染失败', err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

function renderTaskBreakdown(breakdown) {
  const items = [
    { key: 'red',      label: '红词（到期）',  color: 'var(--color-red)' },
    { key: 'yellow',   label: '黄词（到期）',  color: 'var(--color-yellow)' },
    { key: 'spelling', label: '会写词',        color: 'var(--color-primary)' },
    { key: 'error',    label: '错词回炉',      color: '#ff7043' },
    { key: 'green',    label: '绿词抽查',      color: 'var(--color-green)' },
  ].filter(item => breakdown[item.key] > 0);

  if (!items.length) return '<div style="color:var(--color-text-disabled);font-size:var(--font-size-sm)">今日无新任务</div>';

  return items.map(item => `
    <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-1) 0">
      <div style="width:8px;height:8px;border-radius:50%;background:${item.color};flex-shrink:0"></div>
      <span style="flex:1;font-size:var(--font-size-sm)">${item.label}</span>
      <span style="font-weight:var(--font-weight-bold);color:${item.color}">${breakdown[item.key]}</span>
    </div>
  `).join('');
}

// ==================== 练习页 ====================

async function renderPractice(container) {
  setHeaderTitle('今日练习');
  setBackBtn(true, '/');
  await initPractice(container, {
    onComplete: () => window._router?.go('/'),
  });
}

// ==================== 单词本 ====================

async function renderWords(container) {
  setHeaderTitle('单词本');
  setBackBtn(false);

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const words = await getAllWords();

    if (!words.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">单词本为空</div>
          <div class="empty-state-desc">去录入页面添加第一批单词吧</div>
          <button class="btn btn-primary" id="btnGoImport">去录入</button>
        </div>
      `;
      container.querySelector('#btnGoImport')?.addEventListener('click', () => window._router?.go('/import'));
      return;
    }

    // 按周次分组
    const byWeek = {};
    words.forEach(w => {
      const k = w.week_id || 0;
      if (!byWeek[k]) byWeek[k] = [];
      byWeek[k].push(w);
    });

    // 获取周次名称
    const weeks = await getAllWeeks();
    const weekMap = new Map(weeks.map(w => [w.id, w.label]));

    let html = `
      <!-- 搜索框 -->
      <div style="margin-bottom:var(--space-3)">
        <input type="search" class="form-input" id="wordSearch" placeholder="搜索单词…" />
      </div>
      <div id="wordListContainer">
    `;

    Object.entries(byWeek)
      .sort(([a], [b]) => Number(b) - Number(a))
      .forEach(([weekId, weekWords]) => {
        const label = weekMap.get(Number(weekId)) || `第 ${weekId} 周`;
        html += `<div class="section-title">${esc(label)}（${weekWords.length}）</div>`;
        html += '<div class="word-list">';
        weekWords.forEach(w => {
          const mastery = w.progress?.mastery_level || 'red';
          html += `
            <div class="word-item" data-word-id="${w.id}">
              <div>
                <div class="word-item-english">${esc(w.english)}</div>
                <div class="word-item-chinese">${esc(w.chinese)}</div>
              </div>
              <span class="badge badge-${mastery}">${
                mastery === 'red' ? '未掌握' : mastery === 'yellow' ? '学习中' : '已掌握'
              }</span>
              <span class="week-chip">${w.word_type === 'spelling' ? '会写' : '认读'}</span>
            </div>
          `;
        });
        html += '</div>';
      });

    html += '</div>';
    container.innerHTML = html;

    // 搜索过滤
    const searchInput = container.querySelector('#wordSearch');
    searchInput?.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      container.querySelectorAll('.word-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

// ==================== 录入页 ====================

async function renderImport(container) {
  setHeaderTitle('录入单词');
  setBackBtn(false);

  const weeks = await getAllWeeks();
  const weekOptions = weeks
    .sort((a, b) => b.week_number - a.week_number)
    .map(w => `<option value="${w.id}">${esc(w.label)}</option>`)
    .join('');

  container.innerHTML = `
    <!-- 新建周次 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="section-title" style="padding-top:0">周次管理</div>
      <div style="display:flex;gap:var(--space-2)">
        <input type="number" class="form-input" id="newWeekNum" placeholder="周次编号" min="1" style="width:120px" />
        <input type="text" class="form-input" id="newWeekLabel" placeholder="如：第1周（2024.9.2）" style="flex:1" />
        <button class="btn btn-secondary" id="btnAddWeek">添加</button>
      </div>
    </div>

    <!-- 批量导入 -->
    <div class="card">
      <div class="section-title" style="padding-top:0">批量录入单词</div>

      <div class="form-group">
        <label class="form-label">选择周次</label>
        <select class="form-select" id="selectWeek">
          <option value="">— 请先选择周次 —</option>
          ${weekOptions}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">词类型</label>
        <select class="form-select" id="selectWordType">
          <option value="recognition">认读词（只需认识）</option>
          <option value="spelling">会写词（需要拼写）</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">单词数据</label>
        <textarea class="form-textarea" id="wordData" rows="8"
          placeholder="每行一个，格式：英文,中文,词性（词性可省略）&#10;例如：&#10;apple,苹果,n.&#10;run,跑步&#10;beautiful,美丽的,adj."></textarea>
        <div class="form-hint">每行：英文,中文（可选词性），逗号分隔。词性可留空。</div>
      </div>

      <button class="btn btn-primary btn-full" id="btnImport">导入单词</button>
    </div>

    <!-- CSV 导入 -->
    <div class="card" style="margin-top:var(--space-4)">
      <div class="section-title" style="padding-top:0">CSV 文件导入</div>
      <div class="form-group">
        <label class="form-label">选择周次（同上）</label>
        <select class="form-select" id="selectWeekCsv">
          <option value="">— 请先选择周次 —</option>
          ${weekOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">词类型</label>
        <select class="form-select" id="selectWordTypeCsv">
          <option value="recognition">认读词</option>
          <option value="spelling">会写词</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">CSV 文件（UTF-8，列：英文,中文,词性）</label>
        <input type="file" class="form-input" id="csvFile" accept=".csv,.txt" />
      </div>
      <button class="btn btn-secondary btn-full" id="btnImportCsv">导入 CSV</button>
    </div>

    <!-- 数据导出 -->
    <div class="card" style="margin-top:var(--space-4);margin-bottom:var(--space-8)">
      <div class="section-title" style="padding-top:0">数据备份</div>
      <button class="btn btn-ghost btn-full" id="btnExport">导出全部数据（JSON）</button>
    </div>
  `;

  bindImportEvents(container, weeks);
}

function bindImportEvents(container, _weeks) {
  // 添加周次
  container.querySelector('#btnAddWeek')?.addEventListener('click', async () => {
    const numInput   = container.querySelector('#newWeekNum');
    const labelInput = container.querySelector('#newWeekLabel');
    const num   = parseInt(numInput?.value, 10);
    const label = labelInput?.value.trim();

    if (!num || num < 1) { showToast('请输入有效的周次编号', 'error'); return; }

    try {
      await upsertWeek(num, label || `第${num}周`);
      showToast('周次已添加');
      // 刷新页面
      window._router?.replace('/import');
    } catch (err) {
      showToast('添加失败：' + err.message, 'error');
    }
  });

  // 批量录入
  container.querySelector('#btnImport')?.addEventListener('click', async () => {
    const weekId   = Number(container.querySelector('#selectWeek')?.value);
    const wordType = container.querySelector('#selectWordType')?.value;
    const raw      = container.querySelector('#wordData')?.value.trim();

    if (!weekId)  { showToast('请先选择周次', 'error'); return; }
    if (!raw)     { showToast('请输入单词数据', 'error'); return; }

    const wordList = parseWordText(raw, weekId, wordType);
    if (!wordList.length) { showToast('未解析到有效单词，请检查格式', 'error'); return; }

    showLoading(true);
    try {
      const ids = await addWords(wordList);
      showLoading(false);
      showToast(`成功导入 ${ids.length} 个单词`);
      container.querySelector('#wordData').value = '';
    } catch (err) {
      showLoading(false);
      showToast('导入失败：' + err.message, 'error');
    }
  });

  // CSV 导入
  container.querySelector('#btnImportCsv')?.addEventListener('click', async () => {
    const weekId   = Number(container.querySelector('#selectWeekCsv')?.value);
    const wordType = container.querySelector('#selectWordTypeCsv')?.value;
    const fileInput = container.querySelector('#csvFile');
    const file = fileInput?.files?.[0];

    if (!weekId) { showToast('请先选择周次', 'error'); return; }
    if (!file)   { showToast('请先选择 CSV 文件', 'error'); return; }

    showLoading(true);
    try {
      const text = await file.text();
      const wordList = parseWordText(text, weekId, wordType);
      if (!wordList.length) {
        showLoading(false);
        showToast('未解析到有效单词，请检查 CSV 格式', 'error');
        return;
      }
      const ids = await addWords(wordList);
      showLoading(false);
      showToast(`成功导入 ${ids.length} 个单词`);
      fileInput.value = '';
    } catch (err) {
      showLoading(false);
      showToast('导入失败：' + err.message, 'error');
    }
  });

  // 数据导出
  container.querySelector('#btnExport')?.addEventListener('click', async () => {
    showLoading(true);
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ket-vocab-backup-${getTodayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showLoading(false);
      showToast('数据已导出');
    } catch (err) {
      showLoading(false);
      showToast('导出失败：' + err.message, 'error');
    }
  });
}

/**
 * 解析文本格式单词（逐行：英文,中文[,词性]）
 * 跳过空行、注释行（#）、CSV 表头（english/word）
 */
function parseWordText(text, weekId, wordType) {
  const lines = text.split(/\r?\n/);
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(',').map(s => s.trim());
    if (parts.length < 2) continue;

    const english = parts[0].toLowerCase();
    const chinese = parts[1];
    const pos     = parts[2] || '';

    // 跳过表头
    if (english === 'english' || english === 'word' || english === '英文') continue;
    if (!english || !chinese) continue;

    result.push({ english, chinese, part_of_speech: pos, word_type: wordType, week_id: weekId });
  }

  return result;
}

// ==================== 错词本 ====================

async function renderErrors(container) {
  setHeaderTitle('错词本');
  setBackBtn(false);

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const errorWords = await getErrorWords();

    if (!errorWords.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">错词本为空</div>
          <div class="empty-state-desc">继续加油，保持零错误！</div>
        </div>
      `;
      return;
    }

    let html = `
      <div style="margin-bottom:var(--space-3)">
        <div class="section-title" style="padding:0 0 var(--space-2)">共 ${errorWords.length} 个错词</div>
      </div>
      <div class="word-list">
    `;

    errorWords.forEach(w => {
      html += `
        <div class="word-item">
          <div style="flex:1">
            <div class="word-item-english">${esc(w.english)}</div>
            <div class="word-item-chinese">${esc(w.chinese)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--space-1)">
            <span class="badge badge-red">错词</span>
            <button class="btn-icon" data-action="clear-error" data-word-id="${w.id}" title="标记已掌握" style="width:32px;height:32px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;

    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="clear-error"]');
      if (!btn) return;
      const wordId = Number(btn.dataset.wordId);
      try {
        await clearErrorWord(wordId);
        showToast('已标记为掌握');
        await renderErrors(container);
      } catch (err) {
        showToast('操作失败', 'error');
      }
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

// ==================== 统计页 ====================

async function renderStatsFn(container) {
  setHeaderTitle('学习统计');
  setBackBtn(false);
  await initStats(container);
}

// ==================== 设置页 ====================

async function renderSettings(container) {
  setHeaderTitle('设置');
  setBackBtn(false);

  const settings = loadSettings();

  container.innerHTML = `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="section-title" style="padding-top:0">每日任务</div>

      <div class="form-group">
        <label class="form-label">每日最多题数（默认 30）</label>
        <input type="number" class="form-input" id="maxQuestions" value="${settings.maxDailyQuestions}" min="5" max="100" />
      </div>

      <div style="display:flex;align-items:center;gap:var(--space-3)">
        <label class="toggle">
          <input type="checkbox" id="enableSpotCheck" ${settings.enableSpotCheck ? 'checked' : ''} />
          <div class="toggle-track"></div>
        </label>
        <span style="font-size:var(--font-size-sm)">开启绿词抽查</span>
      </div>
    </div>

    <button class="btn btn-primary btn-full" id="btnSaveSettings">保存设置</button>

    <div style="margin-top:var(--space-8);padding-bottom:var(--space-8)">
      <div class="section-title">关于</div>
      <div class="card" style="font-size:var(--font-size-sm);color:var(--color-text-secondary);line-height:var(--line-height-loose)">
        <div>KET 单词滚动复习系统 v1.0</div>
        <div>间隔重复算法：0/1/3/7/14/30 天</div>
        <div>数据本地存储，不上传服务器</div>
      </div>
    </div>
  `;

  container.querySelector('#btnSaveSettings')?.addEventListener('click', () => {
    const maxQ = parseInt(container.querySelector('#maxQuestions')?.value, 10);
    const spotCheck = container.querySelector('#enableSpotCheck')?.checked;

    if (!maxQ || maxQ < 5 || maxQ > 100) {
      showToast('每日题数请设置在 5~100 之间', 'error');
      return;
    }

    saveSettings({ maxDailyQuestions: maxQ, enableSpotCheck: spotCheck });
    showToast('设置已保存');
  });
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('ket-vocab-settings') || '{}');
  } catch {
    return {};
  }
}

function saveSettings(s) {
  const current = loadSettings();
  localStorage.setItem('ket-vocab-settings', JSON.stringify({ ...current, ...s }));
}

// ==================== 全局 UI 工具 ====================

/** 设置顶部标题 */
function setHeaderTitle(title) {
  const el = document.getElementById('headerTitle');
  if (el) el.textContent = title;
}

/** 设置返回按钮 */
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

/** 显示/隐藏全局加载遮罩 */
export function showLoading(show) {
  document.getElementById('loadingOverlay')?.classList.toggle('hidden', !show);
}

/** 全局 Toast 通知 */
export function showToast(message, type = 'default', duration = 2500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? `toast-${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity    = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** 致命错误（覆盖整屏） */
function showFatalError(msg) {
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100dvh;padding:32px;text-align:center;gap:16px">
      <div style="font-size:48px">⚠️</div>
      <div style="font-size:20px;font-weight:700;color:#1A1A2E">无法启动</div>
      <div style="font-size:14px;color:#64748B;white-space:pre-line">${esc(msg)}</div>
    </div>
  `;
}

/** XSS 防护 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==================== 启动 ====================

main().catch(err => {
  console.error('[App] 启动失败', err);
});
