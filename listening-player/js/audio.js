/**
 * listening-player/js/audio.js — 音频引擎
 *
 * 核心功能：
 *   - 从 IndexedDB Blob 创建 ObjectURL，驱动 HTMLAudioElement
 *   - rAF（requestAnimationFrame）循环检测段落边界（不用 timeupdate）
 *     原因：iOS Safari 将 timeupdate 节流到 ~250ms，会导致段落结尾漏触发
 *   - 变速播放（0.75x / 0.85x / 1.0x）
 *   - 单句循环（指定 start/end 的区间循环）
 *   - 暴露 currentTime、duration、playing 等响应式状态供 UI 使用
 */

'use strict';

import { updateAudioDuration } from './db.js';

// ==================== 常量 ====================

export const SPEEDS = [0.75, 0.85, 1.0];

// rAF 检测的提前量（秒）：在距离结束 LOOKAHEAD 秒内触发循环
const LOOP_LOOKAHEAD = 0.05;

// ==================== AudioEngine 类 ====================

export class AudioEngine {
  constructor() {
    this._el       = new Audio();
    this._el.preload = 'auto';
    this._el.crossOrigin = 'anonymous';

    this._objectUrl  = null;  // createObjectURL 的临时 URL
    this._audioId    = null;  // 当前音频的 DB id
    this._rafId      = null;  // requestAnimationFrame handle

    // 循环区间
    this._loopStart  = null;  // 秒
    this._loopEnd    = null;  // 秒
    this._loopEnabled = false;
    this._loopCount  = 0;     // 已循环次数（0 = 无限）
    this._loopDone   = 0;     // 已完成循环次数

    // 回调
    this._onTimeUpdate  = null;  // (currentTime, duration) => void
    this._onEnded       = null;  // () => void
    this._onLoopDone    = null;  // (count) => void，每完成一次循环
    this._onError       = null;  // (err) => void

    this._speed = 1.0;

    this._bindNativeEvents();
  }

  // ==================== 加载音频 ====================

  /**
   * 从 Blob 加载音频
   * @param {Blob}   blob
   * @param {number} audioId  DB id（加载后更新 duration）
   * @returns {Promise<number>}  duration（秒）
   */
  async loadBlob(blob, audioId) {
    this.stop();
    this._freeObjectUrl();

    this._objectUrl = URL.createObjectURL(blob);
    this._audioId   = audioId;
    this._el.src    = this._objectUrl;
    this._el.playbackRate = this._speed;
    this._el.load();

    return new Promise((resolve, reject) => {
      const onMeta = () => {
        cleanup();
        const dur = this._el.duration;
        if (audioId) updateAudioDuration(audioId, dur).catch(() => {});
        resolve(dur);
      };
      const onErr = (e) => {
        cleanup();
        reject(new Error(`音频加载失败: ${e.target?.error?.message || '未知'}`));
      };
      const cleanup = () => {
        this._el.removeEventListener('loadedmetadata', onMeta);
        this._el.removeEventListener('error', onErr);
      };
      this._el.addEventListener('loadedmetadata', onMeta, { once: true });
      this._el.addEventListener('error', onErr, { once: true });
    });
  }

  // ==================== 播放控制 ====================

  async play() {
    try {
      await this._el.play();
      this._startRaf();
    } catch (err) {
      if (err.name !== 'AbortError') this._onError?.(err);
    }
  }

  pause() {
    this._el.pause();
    this._stopRaf();
  }

  stop() {
    this._el.pause();
    this._el.currentTime = 0;
    this._stopRaf();
    this._loopDone = 0;
  }

  get playing() {
    return !this._el.paused && !this._el.ended;
  }

  get currentTime() {
    return this._el.currentTime;
  }

  set currentTime(t) {
    this._el.currentTime = Math.max(0, Math.min(t, this._el.duration || 0));
  }

  get duration() {
    return this._el.duration || 0;
  }

  // ==================== 变速 ====================

  setSpeed(speed) {
    this._speed = speed;
    this._el.playbackRate = speed;
  }

  get speed() { return this._speed; }

  cycleSpeed() {
    const idx = SPEEDS.indexOf(this._speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    this.setSpeed(next);
    return next;
  }

  // ==================== 区间循环 ====================

  /**
   * 设置循环区间
   * @param {number} start       秒
   * @param {number} end         秒
   * @param {number} loopCount   0 = 无限循环；>0 = 指定次数后停止
   */
  setLoop(start, end, loopCount = 0) {
    this._loopStart   = start;
    this._loopEnd     = end;
    this._loopEnabled = true;
    this._loopCount   = loopCount;
    this._loopDone    = 0;
    // 跳到起始位置
    this._el.currentTime = start;
  }

  clearLoop() {
    this._loopEnabled = false;
    this._loopStart   = null;
    this._loopEnd     = null;
    this._loopCount   = 0;
    this._loopDone    = 0;
  }

  get loopEnabled() { return this._loopEnabled; }

  /**
   * 跳转到指定句段并开始循环播放
   */
  async playSegment(startTime, endTime, loopCount = 0) {
    this.setLoop(startTime, endTime, loopCount);
    if (!this.playing) await this.play();
  }

  // ==================== 跳转 ====================

  seekTo(seconds) {
    this._el.currentTime = Math.max(0, Math.min(seconds, this.duration));
  }

  seekByPercent(pct) {
    this.seekTo(pct * this.duration);
  }

  // ==================== 回调注册 ====================

  onTimeUpdate(fn)  { this._onTimeUpdate = fn; }
  onEnded(fn)       { this._onEnded      = fn; }
  onLoopDone(fn)    { this._onLoopDone   = fn; }
  onError(fn)       { this._onError      = fn; }

  // ==================== rAF 循环 ====================

  _startRaf() {
    if (this._rafId !== null) return;
    const tick = () => {
      if (!this._el.paused && !this._el.ended) {
        this._checkLoop();
        this._onTimeUpdate?.(this._el.currentTime, this._el.duration);
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopRaf() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * 在 rAF 中检查是否到达循环段末尾
   * CRITICAL: 不用 timeupdate（iOS Safari 节流到 250ms，会漏掉短句结尾）
   */
  _checkLoop() {
    if (!this._loopEnabled) return;

    const t = this._el.currentTime;
    const end = this._loopEnd;

    if (t >= end - LOOP_LOOKAHEAD) {
      this._loopDone++;
      this._onLoopDone?.(this._loopDone);

      if (this._loopCount > 0 && this._loopDone >= this._loopCount) {
        // 指定循环次数已完成
        this.clearLoop();
        this._el.pause();
        this._stopRaf();
        this._onEnded?.();
        return;
      }

      // 回到起始继续循环
      this._el.currentTime = this._loopStart;
    }
  }

  // ==================== 原生事件 ====================

  _bindNativeEvents() {
    this._el.addEventListener('ended', () => {
      this._stopRaf();
      if (!this._loopEnabled) {
        this._onEnded?.();
      }
    });

    this._el.addEventListener('error', (e) => {
      this._stopRaf();
      this._onError?.(new Error(e.target?.error?.message || '播放错误'));
    });

    // playing 事件保证 rAF 在恢复播放时重启
    this._el.addEventListener('playing', () => {
      this._startRaf();
    });
  }

  // ==================== 清理 ====================

  destroy() {
    this.stop();
    this._freeObjectUrl();
    this._el.src = '';
  }

  _freeObjectUrl() {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }
}

// ==================== 时间格式化工具 ====================

/**
 * 秒 → "m:ss" 或 "mm:ss"
 */
export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

/**
 * "m:ss.xx" → 秒（浮点）
 */
export function parseTime(str) {
  const parts = String(str).split(':');
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return Number(str) || 0;
}
