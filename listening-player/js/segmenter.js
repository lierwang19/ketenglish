/**
 * listening-player/js/segmenter.js — 自动切分 + 人工校正
 *
 * V1.0 自动切分策略（不依赖 Whisper）：
 *   1. 按标点/语气词切分：句号、问号、感叹号、逗号（较长时）
 *   2. 均匀分配时间：根据字符数比例估算每句的时间区间
 *   3. 输出结构与 Whisper 精确时间戳兼容，后续可无缝升级
 *
 * 人工校正：
 *   renderEditor() — 渲染可编辑的切分列表
 *   支持：拆分 / 合并 / 修改时间 / 修改文本 / 删除 / 保存
 */

'use strict';

import {
  replaceSegments,
  getSegmentsByAudio,
  updateSegment,
  splitSegment,
  mergeSegments,
} from './db.js';
import { formatTime, parseTime } from './audio.js';

// ==================== 自动切分 ====================

/**
 * 将原文按句切分，均匀分配时间
 *
 * @param {string} fullText    — 原文
 * @param {number} duration    — 音频总时长（秒）
 * @param {object} opts
 * @param {number} opts.setId
 * @param {number} opts.audioId
 * @param {number} opts.partNo
 * @param {number} opts.questionNo
 * @param {boolean} opts.save   — 是否直接写入 DB（默认 true）
 * @returns {Promise<Array>}  句段数组
 */
export async function autoSegment(fullText, duration, opts = {}) {
  const {
    setId, audioId, partNo = 1, questionNo = 1, save = true,
  } = opts;

  const sentences = splitIntoSentences(fullText.trim());
  if (!sentences.length) return [];

  const totalChars = sentences.reduce((s, t) => s + t.length, 0);
  let cursor = 0;

  const segments = sentences.map((text, i) => {
    const charRatio  = text.length / Math.max(totalChars, 1);
    const segDur     = duration * charRatio;
    const start_time = cursor;
    const end_time   = Math.min(cursor + segDur, duration);
    cursor = end_time;

    return {
      segment_no:   i + 1,
      start_time:   +start_time.toFixed(3),
      end_time:     +end_time.toFixed(3),
      segment_text: text,
      part_no:      partNo,
      question_no:  questionNo,
      status:       'auto',
    };
  });

  // 修正最后一句的结束时间到 duration
  if (segments.length) {
    segments[segments.length - 1].end_time = +duration.toFixed(3);
  }

  if (save && setId != null && audioId != null) {
    await replaceSegments(setId, audioId, segments);
  }

  return segments;
}

/**
 * 将原文分割成句子列表
 *
 * 分割规则：
 *   - 在句号 / 问号 / 感叹号后断句（可选后跟空格）
 *   - 超长片段（> MAX_CHARS）在逗号处继续断
 *   - 过滤空字符串
 */
export function splitIntoSentences(text) {
  const MAX_CHARS = 80; // 超过此长度尝试在逗号处继续断

  // Step1: 按强标点断句
  const strong = text
    .replace(/([.!?])\s+/g, '$1\n')
    .replace(/([.!?])$/,    '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  // Step2: 超长句在逗号处再断
  const result = [];
  for (const sent of strong) {
    if (sent.length <= MAX_CHARS) {
      result.push(sent);
      continue;
    }
    // 按逗号断
    const parts = sent.split(/,\s*/).filter(Boolean);
    let buf = '';
    for (const part of parts) {
      if (buf && (buf + ', ' + part).length > MAX_CHARS) {
        result.push(buf);
        buf = part;
      } else {
        buf = buf ? buf + ', ' + part : part;
      }
    }
    if (buf) result.push(buf);
  }

  return result.filter(s => s.length > 0);
}

// ==================== 校正页渲染 ====================

/**
 * 渲染人工校正编辑器
 *
 * @param {HTMLElement} container
 * @param {number}      audioId
 * @param {AudioEngine} audioEngine
 * @param {Function}    onSaved   — 保存完成回调
 */
export async function renderEditor(container, audioId, audioEngine, onSaved) {
  let segments = await getSegmentsByAudio(audioId);

  const render = () => {
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">
          共 ${segments.length} 个句段
          <span style="color:var(--color-text-disabled);margin-left:var(--space-2)">点击时间可编辑</span>
        </div>
        <button class="btn btn-primary btn-sm" id="btnSaveSegments">保存切分</button>
      </div>
      <div class="seg-editor" id="segEditorList">
        ${segments.map((seg, idx) => renderSegItem(seg, idx, segments.length)).join('')}
      </div>
    `;

    bindEditorEvents(container, audioId, audioEngine, () => {
      getSegmentsByAudio(audioId).then(segs => {
        segments = segs;
        render();
      });
    }, onSaved);
  };

  render();
}

function renderSegItem(seg, idx, total) {
  return `
    <div class="seg-editor-item" data-seg-id="${seg.id}">
      <div class="seg-editor-num">${idx + 1}</div>
      <div class="seg-editor-body">
        <div class="seg-editor-text" contenteditable="true"
             data-field="text" data-seg-id="${seg.id}"
             style="outline:none;min-height:20px"
        >${esc(seg.segment_text)}</div>
        <div class="seg-editor-times">
          <input type="text" class="seg-time-input" value="${formatTime(seg.start_time)}"
                 data-field="start" data-seg-id="${seg.id}" placeholder="0:00" />
          <span style="color:var(--color-text-disabled)">→</span>
          <input type="text" class="seg-time-input" value="${formatTime(seg.end_time)}"
                 data-field="end" data-seg-id="${seg.id}" placeholder="0:00" />
          <span style="font-size:var(--font-size-xs);color:var(--color-text-disabled)">
            ${formatTime(seg.end_time - seg.start_time)}
          </span>
        </div>
      </div>
      <div class="seg-editor-ops">
        <!-- 试听 -->
        <button class="seg-op-btn" data-action="preview" data-seg-id="${seg.id}" title="试听">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <!-- 拆分 -->
        <button class="seg-op-btn" data-action="split" data-seg-id="${seg.id}" title="在此拆分">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/></svg>
        </button>
        <!-- 向下合并 -->
        ${idx < total - 1 ? `
        <button class="seg-op-btn" data-action="merge" data-seg-id="${seg.id}" title="与下句合并">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 6 4 12 8 18"/><polyline points="16 6 20 12 16 18"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
        </button>
        ` : ''}
        <!-- 删除 -->
        <button class="seg-op-btn danger" data-action="delete" data-seg-id="${seg.id}" title="删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>
    </div>
  `;
}

function bindEditorEvents(container, audioId, audioEngine, refresh, onSaved) {
  const list = container.querySelector('#segEditorList');
  if (!list) return;

  // 操作按钮
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const segId  = Number(btn.dataset.segId);

    if (action === 'preview') {
      const seg = await getSegmentById(segId, audioId);
      if (seg && audioEngine) {
        await audioEngine.playSegment(seg.start_time, seg.end_time, 1);
      }
    }

    if (action === 'split') {
      // 在中点拆分
      const seg = await getSegmentById(segId, audioId);
      if (!seg) return;
      const mid = (seg.start_time + seg.end_time) / 2;
      try {
        await splitSegment(segId, mid);
        refresh();
      } catch (err) {
        alert('拆分失败：' + err.message);
      }
    }

    if (action === 'merge') {
      // 找到下一句
      const allSegs = await getSegmentsByAudio(audioId);
      const idx = allSegs.findIndex(s => s.id === segId);
      if (idx < 0 || idx >= allSegs.length - 1) return;
      const nextId = allSegs[idx + 1].id;
      try {
        await mergeSegments(segId, nextId);
        refresh();
      } catch (err) {
        alert('合并失败：' + err.message);
      }
    }

    if (action === 'delete') {
      if (!confirm('确定删除这个句段？')) return;
      try {
        await updateSegment(segId, { _deleted: true });
        // 实际上通过 replaceSegments 重建；这里简单地把文本置空后刷新
        const allSegs = await getSegmentsByAudio(audioId);
        const filtered = allSegs.filter(s => s.id !== segId);
        await replaceSegments(
          filtered[0]?.set_id,
          audioId,
          filtered.map((s, i) => ({ ...s, segment_no: i + 1 }))
        );
        refresh();
      } catch (err) {
        alert('删除失败：' + err.message);
      }
    }
  });

  // 时间输入框失焦保存
  list.addEventListener('change', async (e) => {
    const input = e.target.closest('.seg-time-input');
    if (!input) return;
    const segId = Number(input.dataset.segId);
    const field = input.dataset.field;
    const seconds = parseTime(input.value);
    const patch = field === 'start'
      ? { start_time: seconds }
      : { end_time:   seconds };
    try {
      await updateSegment(segId, patch);
    } catch (err) {
      console.warn('[Segmenter] 时间保存失败', err);
    }
  });

  // 文本内容编辑失焦保存
  list.addEventListener('blur', async (e) => {
    const el = e.target.closest('[data-field="text"]');
    if (!el) return;
    const segId = Number(el.dataset.segId);
    const text  = el.textContent.trim();
    try {
      await updateSegment(segId, { segment_text: text });
    } catch (err) {
      console.warn('[Segmenter] 文本保存失败', err);
    }
  }, true);

  // 保存按钮
  container.querySelector('#btnSaveSegments')?.addEventListener('click', () => {
    onSaved?.();
  });
}

async function getSegmentById(segId, audioId) {
  const all = await getSegmentsByAudio(audioId);
  return all.find(s => s.id === segId) || null;
}

// ==================== 工具 ====================

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
