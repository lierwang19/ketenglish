/**
 * listening-player/js/app.js — 系统B 应用入口
 *
 * 页面：
 *   /           — 首页（套题列表）
 *   /set-edit   — 新建/编辑套题 + 上传音频 + 录入原文 + 自动切分
 *   /segment    — 人工校正切分页
 *   /train      — 训练主页（精听/考试/复盘）
 *   /difficult  — 全局错句本
 *   /stats      — 统计
 *   /settings   — 设置
 */

'use strict';

import { createRouter }              from '../../shared/router.js';
import { checkIndexedDBAvailable }  from '../../shared/db.js';
import {
  initDB, getAllSets, getSet, createSet, updateSet, deleteSet,
  saveAudio, getAudiosBySet, getAudio,
  saveTranscript, getTranscriptsBySet,
  getSegmentsByAudio, getSegmentsBySet,
  getSetStats, getAllDifficults, getOverallStats, exportSetData,
} from './db.js';
import { autoSegment, renderEditor } from './segmenter.js';
import { Player, MODES } from './player.js';
import { formatTime }   from './audio.js';

// ==================== 全局状态 ====================

let _activePlayer = null;  // 当前 Player 实例
let _editSetId    = null;  // 正在编辑的套题 id
let _editAudioId  = null;  // 正在操作的音频 id

// ==================== 启动 ====================

async function main() {
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
    '/':          () => showPage('home',       renderHome),
    '/set-edit':  () => showPage('set-edit',   renderSetEdit),
    '/segment':   () => showPage('segment',    renderSegmentPage),
    '/train':     () => showPage('train',      renderTrainPage),
    '/difficult': () => showPage('difficult',  renderDifficult),
    '/stats':     () => showPage('stats',      renderStats),
    '/settings':  () => showPage('settings',   renderSettings),
  });

  router.start();
  window._router = router;

  // SW 更新横幅
  document.getElementById('btnSwUpdate')?.addEventListener('click', () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  });
  document.getElementById('btnSwDismiss')?.addEventListener('click', () => {
    document.getElementById('swUpdateBanner')?.classList.add('hidden');
  });
}

// ==================== SW ====================

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/listening-player/sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', function () {
        if (this.state === 'installed' && navigator.serviceWorker.controller) {
          document.getElementById('swUpdateBanner')?.classList.remove('hidden');
        }
      });
    });
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SW_UPDATE_AVAILABLE') {
      document.getElementById('swUpdateBanner')?.classList.remove('hidden');
    }
  });
}

// ==================== 路由 & 页面切换 ====================

const PAGE_MAP = {
  'home':      'pageHome',
  'set-edit':  'pageSetEdit',
  'segment':   'pageSegment',
  'train':     'pageTrain',
  'difficult': 'pageDifficult',
  'stats':     'pageStats',
  'settings':  'pageSettings',
};

async function showPage(name, renderFn) {
  // 切换页面时销毁旧 player
  if (name !== 'train' && _activePlayer) {
    _activePlayer.destroy();
    _activePlayer = null;
    document.getElementById('playerBar')?.classList.add('hidden');
    document.getElementById('pageContainer')?.classList.remove('with-player');
  }

  Object.values(PAGE_MAP).forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  const target = document.getElementById(PAGE_MAP[name]);
  if (!target) return;
  target.classList.remove('hidden');

  updateNavActive(name);
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
  const routeMap = { home: '/', difficult: '/difficult', stats: '/stats', settings: '/settings' };
  const route = routeMap[pageName] || null;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
}

// ==================== 首页 ====================

async function renderHome(container) {
  setHeaderTitle('KET 听力精听');
  setBackBtn(false);
  setHeaderActions('');

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const [sets, stats] = await Promise.all([getAllSets(), getOverallStats()]);

    let html = '';

    // 概览卡
    html += `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-4)">
        <div class="stat-card">
          <div class="stat-number">${stats.setCount}</div>
          <div class="stat-label">套题</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.unresolvedDifficults}</div>
          <div class="stat-label">待回炉</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.totalPlays}</div>
          <div class="stat-label">总播放</div>
        </div>
      </div>
    `;

    // 新建套题按钮
    html += `
      <button class="btn btn-primary btn-full" id="btnNewSet" style="margin-bottom:var(--space-4)">
        + 新建套题
      </button>
    `;

    if (!sets.length) {
      html += `
        <div class="empty-state">
          <div class="empty-state-title">还没有套题</div>
          <div class="empty-state-desc">点击上方按钮新建第一套听力材料</div>
        </div>
      `;
    } else {
      html += sets
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(set => renderSetCard(set))
        .join('');
    }

    container.innerHTML = html;

    container.querySelector('#btnNewSet')?.addEventListener('click', () => {
      _editSetId = null;
      window._router?.go('/set-edit');
    });

    // 套题卡片点击
    container.addEventListener('click', (e) => {
      const card   = e.target.closest('.set-card');
      if (!card) return;

      const setId  = Number(card.dataset.setId);
      const action = e.target.closest('[data-card-action]')?.dataset.cardAction;

      if (action === 'edit') {
        _editSetId = setId;
        window._router?.go('/set-edit');
        return;
      }
      if (action === 'delete') {
        confirmDeleteSet(setId);
        return;
      }
      if (action === 'train') {
        startTrain(setId);
        return;
      }

      // 卡片主体点击 → 训练
      if (!action) startTrain(setId);
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

function renderSetCard(set) {
  return `
    <div class="set-card" data-set-id="${set.id}">
      <div class="set-card-actions">
        <button class="btn-icon" data-card-action="edit" title="编辑">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" data-card-action="delete" title="删除" style="color:var(--color-red)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
      <div class="set-card-title">${esc(set.title)}</div>
      <div class="set-card-meta">
        ${set.source ? `<span>来源：${esc(set.source)}</span>` : ''}
        <span>${set.seg_count || 0} 个句段</span>
        <span>${set.created_at?.slice(0, 10) || ''}</span>
      </div>
      <div style="margin-top:var(--space-3);display:flex;gap:var(--space-2)">
        <button class="btn btn-primary btn-sm" data-card-action="train" style="flex:1">开始训练</button>
        <button class="btn btn-ghost btn-sm" data-card-action="edit">管理材料</button>
      </div>
    </div>
  `;
}

async function confirmDeleteSet(setId) {
  const set = await getSet(setId);
  if (!confirm(`确定删除套题「${set?.title}」？\n此操作不可撤销，将删除音频、句段和所有训练记录。`)) return;
  showLoading(true);
  try {
    await deleteSet(setId);
    showLoading(false);
    showToast('套题已删除');
    window._router?.replace('/');
  } catch (err) {
    showLoading(false);
    showToast('删除失败：' + err.message, 'error');
  }
}

async function startTrain(setId) {
  const audios = await getAudiosBySet(setId);
  if (!audios.length) {
    showToast('请先上传音频并完成切分', 'warning');
    _editSetId = setId;
    window._router?.go('/set-edit');
    return;
  }
  const segs = await getSegmentsByAudio(audios[0].id);
  if (!segs.length) {
    showToast('请先完成句段切分', 'warning');
    _editSetId = setId;
    _editAudioId = audios[0].id;
    window._router?.go('/segment');
    return;
  }
  _editSetId   = setId;
  _editAudioId = audios[0].id;
  window._router?.go('/train');
}

// ==================== 套题管理页 ====================

async function renderSetEdit(container) {
  const isNew = !_editSetId;
  setHeaderTitle(isNew ? '新建套题' : '管理材料');
  setBackBtn(true, '/');

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  let set    = null;
  let audios = [];
  let transcripts = [];

  if (!isNew) {
    [set, audios, transcripts] = await Promise.all([
      getSet(_editSetId),
      getAudiosBySet(_editSetId),
      getTranscriptsBySet(_editSetId),
    ]);
  }

  container.innerHTML = `
    <!-- 基本信息 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="section-title" style="padding-top:0">套题信息</div>
      <div class="form-group">
        <label class="form-label">套题名称 *</label>
        <input type="text" class="form-input" id="setTitle" value="${esc(set?.title || '')}" placeholder="如：KET 2023 Listening Part 1" />
      </div>
      <div class="form-group">
        <label class="form-label">来源</label>
        <input type="text" class="form-input" id="setSource" value="${esc(set?.source || '')}" placeholder="如：剑桥官方真题集" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">备注</label>
        <input type="text" class="form-input" id="setRemark" value="${esc(set?.remark || '')}" placeholder="可选" />
      </div>
    </div>

    <button class="btn btn-primary btn-full" id="btnSaveInfo">
      ${isNew ? '创建套题' : '保存信息'}
    </button>

    ${!isNew ? `
    <!-- 音频上传 -->
    <div class="card" style="margin-top:var(--space-4)">
      <div class="section-title" style="padding-top:0">音频文件</div>
      ${audios.length ? `
        <div id="audioList">
          ${audios.map(a => `
            <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-divider)">
              <div style="flex:1">
                <div style="font-size:var(--font-size-sm);font-weight:var(--font-weight-bold)">${esc(a.file_name)}</div>
                <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">${formatTime(a.duration)} · ${formatFileSize(a.file_size)}</div>
              </div>
              <button class="btn btn-secondary btn-sm" data-audio-id="${a.id}" data-action="segment">切分</button>
              <button class="btn btn-secondary btn-sm" data-audio-id="${a.id}" data-action="train-audio">训练</button>
            </div>
          `).join('')}
        </div>
      ` : `<div style="color:var(--color-text-disabled);font-size:var(--font-size-sm);margin-bottom:var(--space-3)">尚未上传音频</div>`}

      <div class="form-group" style="margin-top:var(--space-3)">
        <label class="form-label">上传音频文件（mp3 / m4a / wav）</label>
        <input type="file" class="form-input" id="audioFile" accept="audio/*,.mp3,.m4a,.wav" />
      </div>
      <button class="btn btn-secondary btn-full" id="btnUploadAudio">上传音频</button>

      <div style="margin-top:var(--space-2)">
        <div style="font-size:var(--font-size-xs);color:var(--color-text-disabled)">
          ⚠️ 音频存储在本地浏览器中。iOS Safari 配额约 50MB，大文件建议用桌面端。
        </div>
      </div>
    </div>

    <!-- 原文录入 -->
    <div class="card" style="margin-top:var(--space-4);margin-bottom:var(--space-8)">
      <div class="section-title" style="padding-top:0">原文录入</div>
      ${audios.length ? `
        <div class="form-group">
          <label class="form-label">选择对应音频</label>
          <select class="form-select" id="transcriptAudioSel">
            ${audios.map(a => `<option value="${a.id}">${esc(a.file_name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div class="form-group">
        <label class="form-label">粘贴英文原文</label>
        <textarea class="form-textarea" id="transcriptText" placeholder="粘贴听力原文…每道题的原文可分开粘贴，或整段粘贴后由系统自动切句。">${esc(transcripts[0]?.full_text || '')}</textarea>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-primary" id="btnSaveTranscript" style="flex:1">保存原文</button>
        ${audios.length ? `
        <button class="btn btn-secondary" id="btnAutoSegment" style="flex:1">自动切分</button>
        ` : ''}
      </div>
    </div>
    ` : ''}
  `;

  bindSetEditEvents(container, isNew, audios);
}

function bindSetEditEvents(container, isNew, audios) {
  // 保存套题信息
  container.querySelector('#btnSaveInfo')?.addEventListener('click', async () => {
    const title  = container.querySelector('#setTitle')?.value.trim();
    const source = container.querySelector('#setSource')?.value.trim();
    const remark = container.querySelector('#setRemark')?.value.trim();

    if (!title) { showToast('请输入套题名称', 'error'); return; }

    showLoading(true);
    try {
      if (isNew) {
        _editSetId = await createSet({ title, source, remark });
        showLoading(false);
        showToast('套题已创建');
        window._router?.replace('/set-edit'); // 刷新页面显示上传区
      } else {
        await updateSet(_editSetId, { title, source, remark });
        showLoading(false);
        showToast('信息已保存');
      }
    } catch (err) {
      showLoading(false);
      showToast('保存失败：' + err.message, 'error');
    }
  });

  // 上传音频
  container.querySelector('#btnUploadAudio')?.addEventListener('click', async () => {
    const fileInput = container.querySelector('#audioFile');
    const file      = fileInput?.files?.[0];
    if (!file) { showToast('请先选择音频文件', 'error'); return; }
    if (!_editSetId) { showToast('请先保存套题信息', 'error'); return; }

    showLoading(true);
    try {
      const audioId = await saveAudio(_editSetId, file);
      showLoading(false);
      showToast('音频上传成功');
      _editAudioId = audioId;
      window._router?.replace('/set-edit'); // 刷新
    } catch (err) {
      showLoading(false);
      showToast('上传失败：' + err.message, 'error');
    }
  });

  // 保存原文
  container.querySelector('#btnSaveTranscript')?.addEventListener('click', async () => {
    const text    = container.querySelector('#transcriptText')?.value.trim();
    const audioSel = container.querySelector('#transcriptAudioSel');
    const audioId  = audioSel ? Number(audioSel.value) : (audios[0]?.id);

    if (!text) { showToast('请先录入原文', 'error'); return; }
    if (!_editSetId) { showToast('请先保存套题信息', 'error'); return; }

    showLoading(true);
    try {
      await saveTranscript(_editSetId, 1, 1, text);
      if (audioId) _editAudioId = audioId;
      showLoading(false);
      showToast('原文已保存');
    } catch (err) {
      showLoading(false);
      showToast('保存失败：' + err.message, 'error');
    }
  });

  // 自动切分
  container.querySelector('#btnAutoSegment')?.addEventListener('click', async () => {
    const text    = container.querySelector('#transcriptText')?.value.trim();
    const audioSel = container.querySelector('#transcriptAudioSel');
    const audioId  = audioSel ? Number(audioSel.value) : (audios[0]?.id);

    if (!text)    { showToast('请先录入原文', 'error'); return; }
    if (!audioId) { showToast('请先上传音频', 'error'); return; }

    showLoading(true);
    try {
      const audioRecord = await getAudio(audioId);
      const duration    = audioRecord?.duration || 0;

      if (duration <= 0) {
        // 需要先从 Blob 获取时长
        const blob   = audioRecord?.blob;
        const blobUrl = URL.createObjectURL(blob);
        const tmpAudio = new Audio(blobUrl);
        await new Promise((resolve) => {
          tmpAudio.addEventListener('loadedmetadata', () => {
            resolve(tmpAudio.duration);
          }, { once: true });
          tmpAudio.load();
        }).then(async (dur) => {
          URL.revokeObjectURL(blobUrl);
          await autoSegment(text, dur, {
            setId: _editSetId, audioId, partNo: 1, questionNo: 1, save: true,
          });
        });
      } else {
        await autoSegment(text, duration, {
          setId: _editSetId, audioId, partNo: 1, questionNo: 1, save: true,
        });
      }

      await saveTranscript(_editSetId, 1, 1, text);
      _editAudioId = audioId;
      showLoading(false);
      showToast('自动切分完成，可进入校正页微调');

      window._router?.go('/segment');
    } catch (err) {
      showLoading(false);
      showToast('切分失败：' + err.message, 'error');
    }
  });

  // 音频列表操作
  container.querySelector('#audioList')?.addEventListener('click', (e) => {
    const btn    = e.target.closest('[data-action]');
    if (!btn) return;
    const action  = btn.dataset.action;
    const audioId = Number(btn.dataset.audioId);
    _editAudioId  = audioId;

    if (action === 'segment') window._router?.go('/segment');
    if (action === 'train-audio') window._router?.go('/train');
  });
}

// ==================== 切分校正页 ====================

async function renderSegmentPage(container) {
  setHeaderTitle('切分校正');
  setBackBtn(true, '/set-edit');

  if (!_editAudioId) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">请先选择音频</div></div>`;
    return;
  }

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const audioRecord = await getAudio(_editAudioId);
    if (!audioRecord) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">音频不存在</div></div>`;
      return;
    }

    // 需要一个轻量 AudioEngine 用于试听（不走完整 Player 初始化）
    const { AudioEngine } = await import('./audio.js');
    const engine = new AudioEngine();
    await engine.loadBlob(audioRecord.blob, audioRecord.id);

    setHeaderActions(`
      <button class="btn btn-sm btn-primary" id="btnGoTrain">开始训练</button>
    `);

    container.innerHTML = `
      <div style="margin-bottom:var(--space-3)">
        <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">
          ${esc(audioRecord.file_name)} · ${formatTime(audioRecord.duration)}
        </div>
      </div>
      <div id="segEditorWrap"></div>
    `;

    document.getElementById('btnGoTrain')?.addEventListener('click', () => {
      window._router?.go('/train');
    });

    const editorWrap = container.querySelector('#segEditorWrap');
    await renderEditor(editorWrap, _editAudioId, engine, () => {
      showToast('切分已保存');
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

// ==================== 训练主页 ====================

async function renderTrainPage(container) {
  if (!_editSetId || !_editAudioId) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">请先选择套题</div></div>`;
    return;
  }

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const [set, audioRecord] = await Promise.all([
      getSet(_editSetId),
      getAudio(_editAudioId),
    ]);

    if (!audioRecord?.blob) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">音频不存在或已损坏</div></div>`;
      return;
    }

    setHeaderTitle(esc(set?.title || '训练'));
    setBackBtn(true, '/');
    setHeaderActions(`
      <button class="btn-icon" id="btnToggleText" title="显示/隐藏原文">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    `);

    // 初始化 Player
    const player = new Player({
      setId:       _editSetId,
      audioId:     _editAudioId,
      audioRecord: audioRecord,
    });
    await player.init();
    _activePlayer = player;

    // 显示播放器栏
    document.getElementById('playerBar')?.classList.remove('hidden');
    document.getElementById('pageContainer')?.classList.add('with-player');

    // 渲染页面
    container.innerHTML = `
      <!-- 模式切换 -->
      <div class="mode-tabs">
        <button class="mode-tab active" data-mode="${MODES.PRECISE}">精听</button>
        <button class="mode-tab" data-mode="${MODES.EXAM}">考试</button>
        <button class="mode-tab" data-mode="${MODES.REVIEW}">复盘</button>
      </div>

      <!-- 句段列表 -->
      <div id="segList"></div>
    `;

    // 渲染句段列表
    player.renderSegmentList(container.querySelector('#segList'));

    // 自动跳转到第一句
    await player.jumpToSegment(0);

    // 绑定模式切换
    container.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        player.setMode(btn.dataset.mode);
      });
    });

    // 隐藏/显示原文
    document.getElementById('btnToggleText')?.addEventListener('click', () => {
      const show = player.toggleText();
      showToast(show ? '已显示原文' : '已隐藏原文');
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

// ==================== 错句本 ====================

async function renderDifficult(container) {
  setHeaderTitle('错句本');
  setBackBtn(false);
  setHeaderActions('');

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const difficults = await getAllDifficults();

    if (!difficults.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">错句本为空</div>
          <div class="empty-state-desc">在训练页点击 ★ 可将难句加入错句本</div>
        </div>
      `;
      return;
    }

    const unresolved = difficults.filter(d => !d.resolved);
    const resolved   = difficults.filter(d =>  d.resolved);

    let html = '';

    if (unresolved.length) {
      html += `<div class="section-title">待回炉（${unresolved.length}）</div>`;
      html += unresolved.map(d => renderDifficultItem(d)).join('');
    }

    if (resolved.length) {
      html += `<div class="section-title" style="margin-top:var(--space-4)">已解决（${resolved.length}）</div>`;
      html += resolved.map(d => renderDifficultItem(d, true)).join('');
    }

    container.innerHTML = html;

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-diff-action]');
      if (!btn) return;
      const action    = btn.dataset.diffAction;
      const segId     = Number(btn.dataset.segId);
      const setId     = Number(btn.dataset.setId);
      const audioId   = Number(btn.dataset.audioId);

      if (action === 'train') {
        _editSetId   = setId;
        _editAudioId = audioId;
        window._router?.go('/train');
      }
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

function renderDifficultItem(d, isResolved = false) {
  const seg = d.segment;
  const set = d.set;
  const priorityLabel = { high: '高危', medium: '难句', low: '轻微' }[d.priority] || '难句';
  const priorityColor = { high: 'var(--color-red)', medium: 'var(--color-yellow)', low: 'var(--color-green)' }[d.priority] || 'var(--color-yellow)';

  return `
    <div class="card" style="margin-bottom:var(--space-2);${isResolved ? 'opacity:0.6' : ''}">
      <div style="display:flex;align-items:flex-start;gap:var(--space-2)">
        <div style="flex:1;min-width:0">
          <div style="font-size:var(--font-size-sm);line-height:var(--line-height-normal);margin-bottom:var(--space-1)">
            ${esc(seg?.segment_text || '（句段文本已删除）')}
          </div>
          <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">
            ${set ? esc(set.title) : ''}
            ${seg ? ` · #${seg.segment_no} · ${formatTime(seg.start_time)}` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--space-1);flex-shrink:0">
          <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);color:${priorityColor}">${priorityLabel}</span>
          ${!isResolved && set && seg ? `
          <button class="btn btn-sm btn-secondary"
                  data-diff-action="train"
                  data-seg-id="${seg.id}"
                  data-set-id="${set.id}"
                  data-audio-id="${seg.audio_id}">
            去训练
          </button>` : ''}
          ${isResolved ? `<span style="font-size:var(--font-size-xs);color:var(--color-green)">✓ 已解决</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ==================== 统计页 ====================

async function renderStats(container) {
  setHeaderTitle('训练统计');
  setBackBtn(false);
  setHeaderActions('');

  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block"></div>';

  try {
    const [sets, overall] = await Promise.all([getAllSets(), getOverallStats()]);

    let html = `
      <!-- 总览 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-4)">
        <div class="stat-card">
          <div class="stat-number">${overall.setCount}</div>
          <div class="stat-label">套题数</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${overall.totalPlays}</div>
          <div class="stat-label">总播放次</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" style="color:var(--color-red)">${overall.unresolvedDifficults}</div>
          <div class="stat-label">待回炉错句</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" style="color:var(--color-green)">${overall.resolvedDifficults}</div>
          <div class="stat-label">已解决错句</div>
        </div>
      </div>

      <!-- 套题列表 -->
      <div class="section-title">各套题详情</div>
    `;

    for (const set of sets) {
      const stats = await getSetStats(set.id);
      const topSegs = Object.entries(stats.bySegment)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      html += `
        <div class="card" style="margin-bottom:var(--space-3)">
          <div style="font-weight:var(--font-weight-bold);margin-bottom:var(--space-2)">${esc(set.title)}</div>
          <div style="display:flex;gap:var(--space-4);font-size:var(--font-size-sm)">
            <div><span style="color:var(--color-text-secondary)">句段：</span><strong>${set.seg_count || 0}</strong></div>
            <div><span style="color:var(--color-text-secondary)">播放：</span><strong>${stats.totalPlays}</strong></div>
          </div>
          ${topSegs.length ? `
          <div style="margin-top:var(--space-2);font-size:var(--font-size-xs);color:var(--color-text-secondary)">
            播放最多的句段：${topSegs.map(([id, count]) => `#${id}（${count}次）`).join('、')}
          </div>` : ''}
          <div style="margin-top:var(--space-3);display:flex;gap:var(--space-2)">
            <button class="btn btn-sm btn-ghost" data-export-set="${set.id}">导出数据</button>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-export-set]');
      if (!btn) return;
      const setId = Number(btn.dataset.exportSet);
      showLoading(true);
      try {
        const data = await exportSetData(setId);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const set  = await getSet(setId);
        a.href     = url;
        a.download = `ket-listen-${set?.title || setId}-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showLoading(false);
        showToast('数据已导出');
      } catch (err) {
        showLoading(false);
        showToast('导出失败：' + err.message, 'error');
      }
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">加载失败：${esc(err.message)}</div></div>`;
  }
}

// ==================== 设置页 ====================

async function renderSettings(container) {
  setHeaderTitle('设置');
  setBackBtn(false);
  setHeaderActions('');

  const s = loadSettings();

  container.innerHTML = `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="section-title" style="padding-top:0">默认播放设置</div>

      <div class="form-group">
        <label class="form-label">默认播放速度</label>
        <select class="form-select" id="defaultSpeed">
          <option value="0.75" ${s.defaultSpeed === 0.75 ? 'selected' : ''}>0.75x（慢速）</option>
          <option value="0.85" ${s.defaultSpeed === 0.85 ? 'selected' : ''}>0.85x（中速）</option>
          <option value="1.0"  ${s.defaultSpeed === 1.0  ? 'selected' : ''}>1.0x（正常）</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">默认循环次数</label>
        <select class="form-select" id="defaultLoopCount">
          <option value="0" ${s.defaultLoopCount === 0 ? 'selected' : ''}>无限循环</option>
          <option value="1" ${s.defaultLoopCount === 1 ? 'selected' : ''}>×1（不循环）</option>
          <option value="3" ${s.defaultLoopCount === 3 ? 'selected' : ''}>×3</option>
          <option value="5" ${s.defaultLoopCount === 5 ? 'selected' : ''}>×5</option>
        </select>
      </div>

      <div style="display:flex;align-items:center;gap:var(--space-3)">
        <label class="toggle">
          <input type="checkbox" id="autoMarkDifficult" ${s.autoMarkDifficult ? 'checked' : ''} />
          <div class="toggle-track"></div>
        </label>
        <span style="font-size:var(--font-size-sm)">自动推荐高频播放句段加入错句本</span>
      </div>
    </div>

    <button class="btn btn-primary btn-full" id="btnSaveSettings">保存设置</button>

    <div style="margin-top:var(--space-8);padding-bottom:var(--space-8)">
      <div class="section-title">关于</div>
      <div class="card" style="font-size:var(--font-size-sm);color:var(--color-text-secondary);line-height:var(--line-height-loose)">
        <div>KET 听力句段精听播放器 v1.0</div>
        <div>音频数据本地存储，不上传服务器</div>
        <div>支持 mp3 / m4a / wav 格式</div>
      </div>
    </div>
  `;

  container.querySelector('#btnSaveSettings')?.addEventListener('click', () => {
    const speed     = parseFloat(container.querySelector('#defaultSpeed')?.value) || 1.0;
    const loopCount = parseInt(container.querySelector('#defaultLoopCount')?.value, 10) || 0;
    const autoMark  = container.querySelector('#autoMarkDifficult')?.checked ?? false;
    saveSettings({ defaultSpeed: speed, defaultLoopCount: loopCount, autoMarkDifficult: autoMark });
    showToast('设置已保存');
  });
}

// ==================== 设置持久化 ====================

function loadSettings() {
  try {
    return {
      defaultSpeed:      1.0,
      defaultLoopCount:  0,
      autoMarkDifficult: false,
      ...JSON.parse(localStorage.getItem('ket-listen-settings') || '{}'),
    };
  } catch {
    return { defaultSpeed: 1.0, defaultLoopCount: 0, autoMarkDifficult: false };
  }
}

function saveSettings(patch) {
  const cur = loadSettings();
  localStorage.setItem('ket-listen-settings', JSON.stringify({ ...cur, ...patch }));
}

// ==================== 全局 UI 工具 ====================

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

function setHeaderActions(html) {
  const el = document.getElementById('headerActions');
  if (el) el.innerHTML = html;
}

export function showLoading(show) {
  document.getElementById('loadingOverlay')?.classList.toggle('hidden', !show);
}

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

function showFatalError(msg) {
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100dvh;padding:32px;text-align:center;gap:16px">
      <div style="font-size:48px">⚠️</div>
      <div style="font-size:20px;font-weight:700">无法启动</div>
      <div style="font-size:14px;color:#64748B;white-space:pre-line">${esc(msg)}</div>
    </div>
  `;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatFileSize(bytes) {
  if (!bytes) return '–';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ==================== Toggle 组件样式补丁（复用系统A样式）========== */
// 注意：toggle 组件在 main.css 中未定义，这里用内联样式实现
const toggleStyle = document.createElement('style');
toggleStyle.textContent = `
  .toggle { position: relative; display: inline-block; width: 48px; height: 28px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-track { position: absolute; inset: 0; background: var(--color-border); border-radius: var(--radius-full); cursor: pointer; transition: background var(--transition-fast); }
  .toggle input:checked + .toggle-track { background: var(--color-primary); }
  .toggle-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; background: white; border-radius: 50%; box-shadow: var(--shadow-sm); transition: transform var(--transition-fast); }
  .toggle input:checked + .toggle-track::after { transform: translateX(20px); }
`;
document.head.appendChild(toggleStyle);

// ==================== 启动 ====================
main().catch(err => console.error('[App] 启动失败', err));
