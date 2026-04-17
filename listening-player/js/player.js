/**
 * listening-player/js/player.js — 播放器 UI 组件
 *
 * 职责：
 *   - 驱动底部播放器栏（playerBar）的所有控件
 *   - 渲染句段列表，支持点击跳转
 *   - 三种模式：精听 / 考试 / 复盘
 *   - 管理"显示/隐藏原文"、"循环次数"、"错句标记"
 *   - 调用 db.js 的 logSegmentPlay 和 markDifficult
 */

'use strict';

import { AudioEngine, formatTime, SPEEDS } from './audio.js';
import {
  getSegmentsByAudio,
  logSegmentPlay,
  markDifficult,
  resolveDifficult,
  getDifficultsBySet,
} from './db.js';

// ==================== 模式常量 ====================

export const MODES = {
  PRECISE: 'precise',  // 精听：句段循环为主
  EXAM:    'exam',     // 考试：整题连续播放
  REVIEW:  'review',  // 复盘：只放错句本
};

// ==================== Player 类 ====================

export class Player {
  /**
   * @param {object} opts
   * @param {number} opts.setId
   * @param {number} opts.audioId
   * @param {object} opts.audioRecord   — DB audio 记录（含 blob, duration 等）
   */
  constructor(opts) {
    this._setId      = opts.setId;
    this._audioId    = opts.audioId;
    this._audioRecord = opts.audioRecord;

    this._engine     = new AudioEngine();
    this._segments   = [];
    this._difficults = new Map(); // segment_id → difficult record
    this._curIdx     = 0;
    this._mode       = MODES.PRECISE;

    this._loopCount  = 0;   // 0 = 无限，1/3/5 = 固定次数
    this._showText   = true;
    this._isReady    = false;

    // 播放统计（当前句段本次播放已循环多少次）
    this._curLoopDone = 0;
  }

  // ==================== 初始化 ====================

  async init() {
    // 加载音频
    await this._engine.loadBlob(this._audioRecord.blob, this._audioId);

    // 加载句段
    this._segments = await getSegmentsByAudio(this._audioId);

    // 加载错句本
    const diffs = await getDifficultsBySet(this._setId);
    this._difficults = new Map(diffs.map(d => [d.segment_id, d]));

    this._isReady = true;
    this._bindEngineCallbacks();
    this._bindPlayerBarEvents();

    return this;
  }

  destroy() {
    this._engine.destroy();
    this._isReady = false;
  }

  // ==================== 渲染 ====================

  /**
   * 渲染句段列表到指定容器
   * @param {HTMLElement} listContainer
   */
  renderSegmentList(listContainer) {
    if (!this._segments.length) {
      listContainer.innerHTML = `
        <div class="empty-state" style="padding:var(--space-8)">
          <div class="empty-state-desc">暂无句段，请先完成切分</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = `<div class="segment-list">${
      this._segments.map((seg, idx) => this._renderSegItem(seg, idx)).join('')
    }</div>`;

    listContainer.addEventListener('click', (e) => {
      const item = e.target.closest('.segment-item');
      if (!item) return;

      const segId = Number(item.dataset.segId);
      const idx   = this._segments.findIndex(s => s.id === segId);
      if (idx < 0) return;

      // 操作按钮
      const action = e.target.closest('[data-seg-action]')?.dataset.segAction;
      if (action === 'mark-difficult') {
        this._toggleDifficult(segId);
        return;
      }
      if (action === 'resolve') {
        this._resolveSegment(segId);
        return;
      }

      this.jumpToSegment(idx);
    });

    this._listContainer = listContainer;
  }

  _renderSegItem(seg, idx) {
    const isActive    = idx === this._curIdx;
    const isDifficult = this._difficults.has(seg.id) && !this._difficults.get(seg.id).resolved;
    const isResolved  = this._difficults.has(seg.id) &&  this._difficults.get(seg.id).resolved;

    let classes = 'segment-item';
    if (isActive)    classes += ' active';
    if (isDifficult) classes += ' difficult';
    if (isResolved)  classes += ' resolved';

    const textHtml = this._showText
      ? `<div class="segment-text">${esc(seg.segment_text)}</div>`
      : `<div class="segment-text blurred">${esc(seg.segment_text)}</div>`;

    return `
      <div class="${classes}" data-seg-id="${seg.id}">
        <div class="segment-number">#${idx + 1}</div>
        ${textHtml}
        <div class="segment-meta">
          <span class="segment-time">${formatTime(seg.start_time)} – ${formatTime(seg.end_time)}</span>
          ${isDifficult ? `<span class="badge-difficult">难句</span>` : ''}
          ${isResolved  ? `<span class="badge-resolved">已解决</span>` : ''}
          <div class="segment-actions">
            <button class="seg-op-btn ${isDifficult ? 'danger' : ''}"
                    data-seg-action="mark-difficult"
                    title="${isDifficult ? '移出错句本' : '加入错句本'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${isDifficult ? 'var(--color-red)' : 'none'}" stroke="${isDifficult ? 'var(--color-red)' : 'currentColor'}" stroke-width="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>
            ${isDifficult ? `
            <button class="seg-op-btn" data-seg-action="resolve" title="标记已解决">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // ==================== 播放控制 ====================

  async jumpToSegment(idx) {
    if (!this._isReady || !this._segments.length) return;
    this._curIdx = Math.max(0, Math.min(idx, this._segments.length - 1));
    const seg = this._segments[this._curIdx];

    this._curLoopDone = 0;

    if (this._mode === MODES.PRECISE) {
      await this._engine.playSegment(seg.start_time, seg.end_time, this._loopCount);
    } else if (this._mode === MODES.EXAM) {
      // 考试模式：从当前句段开始连续播放到结尾
      this._engine.clearLoop();
      this._engine.seekTo(seg.start_time);
      await this._engine.play();
    } else if (this._mode === MODES.REVIEW) {
      // 复盘模式：只放错句本中的句段
      await this._engine.playSegment(seg.start_time, seg.end_time, this._loopCount || 3);
    }

    this._updatePlayerBar();
    this._scrollToActive();
    this._logPlay();
  }

  async playPause() {
    if (!this._isReady) return;
    if (this._engine.playing) {
      this._engine.pause();
    } else {
      await this._engine.play();
    }
    this._updatePlayBtn();
  }

  async prevSegment() {
    if (this._curIdx > 0) await this.jumpToSegment(this._curIdx - 1);
  }

  async nextSegment() {
    if (this._curIdx < this._segments.length - 1) await this.jumpToSegment(this._curIdx + 1);
  }

  // ==================== 模式 ====================

  setMode(mode) {
    this._mode = mode;
    if (!this._segments.length) return;
    this.jumpToSegment(this._curIdx);
  }

  // ==================== 速度 ====================

  cycleSpeed() {
    const speed = this._engine.cycleSpeed();
    const btn = document.getElementById('btnSpeed');
    if (btn) btn.textContent = speed + 'x';
    return speed;
  }

  // ==================== 循环次数 ====================

  setLoopCount(count) {
    this._loopCount = count;
  }

  cycleLoopCount() {
    const options = [0, 1, 3, 5]; // 0=无限
    const idx = options.indexOf(this._loopCount);
    this._loopCount = options[(idx + 1) % options.length];
    this._updateLoopBtn();
    return this._loopCount;
  }

  // ==================== 原文显示 ====================

  toggleText() {
    this._showText = !this._showText;
    // 重新渲染句段列表
    if (this._listContainer) {
      this.renderSegmentList(this._listContainer);
    }
    return this._showText;
  }

  // ==================== 错句本 ====================

  async _toggleDifficult(segId) {
    const seg = this._segments.find(s => s.id === segId);
    if (!seg) return;

    const existing = this._difficults.get(segId);
    if (existing && !existing.resolved) {
      // 已是难句 → 移出
      await resolveDifficult(segId);
      this._difficults.delete(segId);
    } else {
      // 加入错句本
      await markDifficult(segId, this._setId, 'medium', 'manual');
      this._difficults.set(segId, { segment_id: segId, resolved: 0, priority: 'medium' });
    }

    if (this._listContainer) this.renderSegmentList(this._listContainer);
  }

  async _resolveSegment(segId) {
    await resolveDifficult(segId);
    const existing = this._difficults.get(segId);
    if (existing) this._difficults.set(segId, { ...existing, resolved: 1 });
    if (this._listContainer) this.renderSegmentList(this._listContainer);
  }

  // ==================== 播放日志 ====================

  _logPlay() {
    const seg = this._segments[this._curIdx];
    if (!seg) return;
    logSegmentPlay(seg.id, this._setId, {
      play_count:   1,
      speed:        this._engine.speed,
      loop_count:   this._loopCount,
      mode:         this._mode,
      is_difficult: this._difficults.has(seg.id),
    }).catch(() => {});
  }

  // ==================== 底部播放器栏绑定 ====================

  _bindPlayerBarEvents() {
    document.getElementById('btnPlayPause')?.addEventListener('click', () => this.playPause());
    document.getElementById('btnPrevSeg')?.addEventListener('click',  () => this.prevSegment());
    document.getElementById('btnNextSeg')?.addEventListener('click',  () => this.nextSegment());
    document.getElementById('btnSpeed')?.addEventListener('click',    () => this.cycleSpeed());
    document.getElementById('btnLoop')?.addEventListener('click',     () => {
      const count = this.cycleLoopCount();
      const labels = { 0: '∞', 1: '×1', 3: '×3', 5: '×5' };
      const tooltip = `循环 ${labels[count] || count}`;
      document.getElementById('btnLoop')?.setAttribute('title', tooltip);
    });

    // 进度条拖拽
    const track = document.getElementById('playerSeekTrack');
    if (track) {
      let dragging = false;

      const seek = (e) => {
        const rect = track.getBoundingClientRect();
        const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._engine.seekByPercent(pct);
      };

      track.addEventListener('mousedown', (e) => { dragging = true; seek(e); });
      track.addEventListener('touchstart', (e) => { dragging = true; seek(e.touches[0]); }, { passive: true });
      window.addEventListener('mousemove', (e) => { if (dragging) seek(e); });
      window.addEventListener('touchmove', (e) => { if (dragging) seek(e.touches[0]); }, { passive: true });
      window.addEventListener('mouseup',  () => { dragging = false; });
      window.addEventListener('touchend', () => { dragging = false; });
    }
  }

  _bindEngineCallbacks() {
    this._engine.onTimeUpdate((currentTime, duration) => {
      this._updateSeekBar(currentTime, duration);
      this._updatePlayerBar();

      // 考试模式下：自动前进到下一句段
      if (this._mode === MODES.EXAM && !this._engine.loopEnabled) {
        const seg = this._segments[this._curIdx];
        if (seg && currentTime >= seg.end_time - 0.05) {
          const next = this._curIdx + 1;
          if (next < this._segments.length) {
            this._curIdx = next;
            this._updatePlayerBar();
            this._scrollToActive();
          }
        }
      }
    });

    this._engine.onEnded(() => {
      this._updatePlayBtn(false);
      // 精听模式结束后自动到下一句
      if (this._mode === MODES.PRECISE) {
        const next = this._curIdx + 1;
        if (next < this._segments.length) {
          this.jumpToSegment(next);
        }
      }
    });

    this._engine.onLoopDone((count) => {
      this._curLoopDone = count;
    });

    this._engine.onError((err) => {
      console.error('[Player] 音频错误', err);
    });
  }

  // ==================== UI 更新 ====================

  _updatePlayerBar() {
    const seg = this._segments[this._curIdx];
    if (!seg) return;

    const textEl = document.getElementById('playerSegText');
    const metaEl = document.getElementById('playerSegMeta');

    if (textEl) {
      textEl.textContent = this._showText
        ? (seg.segment_text || '—')
        : '（原文已隐藏）';
    }
    if (metaEl) {
      metaEl.textContent = `#${this._curIdx + 1} / ${this._segments.length}  ·  ${formatTime(seg.start_time)}–${formatTime(seg.end_time)}`;
    }

    this._updatePlayBtn();
  }

  _updatePlayBtn(playing) {
    const isPlaying = playing ?? this._engine.playing;
    document.getElementById('iconPlay')?.classList.toggle('hidden',  isPlaying);
    document.getElementById('iconPause')?.classList.toggle('hidden', !isPlaying);
  }

  _updateSeekBar(currentTime, duration) {
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const fill  = document.getElementById('playerSeekFill');
    const thumb = document.getElementById('playerSeekThumb');
    if (fill)  fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
  }

  _updateLoopBtn() {
    const btn = document.getElementById('btnLoop');
    if (!btn) return;
    const isInfinite = this._loopCount === 0;
    btn.classList.toggle('active', true); // 始终高亮（循环始终开启）
    const labels = { 0: '∞', 1: '×1', 3: '×3', 5: '×5' };
    btn.title = '循环 ' + (labels[this._loopCount] || this._loopCount);
  }

  _scrollToActive() {
    if (!this._listContainer) return;
    const active = this._listContainer.querySelector('.segment-item.active');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ==================== Getter ====================

  get currentSegment() { return this._segments[this._curIdx] || null; }
  get segments()       { return this._segments; }
  get mode()           { return this._mode; }
  get engine()         { return this._engine; }
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
