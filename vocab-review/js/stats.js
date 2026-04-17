/**
 * vocab-review/js/stats.js — 统计模块
 *
 * 负责渲染统计页面：
 *   - 总体掌握分布（红/黄/绿 环形图 or 数字卡）
 *   - 最近 14 天复习趋势（折线/柱状）
 *   - 周次进度汇总
 *   - 存储使用情况
 */

'use strict';

import {
  getMasteryStats,
  getRecentStats,
  getAllWeeks,
  getWordsByWeek,
} from './db.js';
import { getStorageEstimate, formatBytes } from '../../shared/db.js';

// ==================== 入口 ====================

/**
 * 渲染统计页
 * @param {HTMLElement} container
 */
export async function initStats(container) {
  container.innerHTML = renderLoading();

  try {
    const [mastery, recent, weeks, storage] = await Promise.all([
      getMasteryStats(),
      getRecentStats(14),
      getAllWeeks(),
      getStorageEstimate(),
    ]);

    container.innerHTML = renderStats({ mastery, recent, weeks, storage });
    bindStatsEvents(container, weeks);
  } catch (err) {
    console.error('[Stats] 渲染失败', err);
    container.innerHTML = renderError(err.message);
  }
}

// ==================== 渲染 ====================

function renderStats({ mastery, recent, weeks, storage }) {
  const { red, yellow, green, total } = mastery;
  const redPct    = total ? Math.round((red    / total) * 100) : 0;
  const yellowPct = total ? Math.round((yellow / total) * 100) : 0;
  const greenPct  = total ? Math.round((green  / total) * 100) : 0;

  return `
    <!-- 掌握分布 -->
    <section>
      <div class="section-title">掌握分布</div>
      <div class="card card-lg">
        <div style="text-align:center;margin-bottom:var(--space-4)">
          <div class="hero-number">${total}</div>
          <div class="hero-label">词汇总量</div>
        </div>

        <div class="mastery-row">
          <div class="mastery-stat red">
            <div class="mastery-count">${red}</div>
            <div class="mastery-label">未掌握</div>
          </div>
          <div class="mastery-stat yellow">
            <div class="mastery-count">${yellow}</div>
            <div class="mastery-label">学习中</div>
          </div>
          <div class="mastery-stat green">
            <div class="mastery-count">${green}</div>
            <div class="mastery-label">已掌握</div>
          </div>
        </div>

        ${total > 0 ? `
        <!-- 三段进度条 -->
        <div style="display:flex;gap:2px;border-radius:var(--radius-full);overflow:hidden;height:12px;margin-top:var(--space-2)">
          ${redPct    > 0 ? `<div style="flex:${redPct};background:var(--color-red);transition:flex var(--transition-slow)"></div>` : ''}
          ${yellowPct > 0 ? `<div style="flex:${yellowPct};background:var(--color-yellow);transition:flex var(--transition-slow)"></div>` : ''}
          ${greenPct  > 0 ? `<div style="flex:${greenPct};background:var(--color-green);transition:flex var(--transition-slow)"></div>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:var(--space-1)">
          <span style="font-size:var(--font-size-xs);color:var(--color-red)">${redPct}%</span>
          <span style="font-size:var(--font-size-xs);color:#b07d00">${yellowPct}%</span>
          <span style="font-size:var(--font-size-xs);color:var(--color-green)">${greenPct}%</span>
        </div>
        ` : '<div class="empty-state-desc" style="padding:var(--space-4)">暂无单词数据</div>'}
      </div>
    </section>

    <!-- 最近 14 天复习记录 -->
    <section style="margin-top:var(--space-4)">
      <div class="section-title">最近复习记录</div>
      <div class="card">
        ${renderRecentChart(recent)}
      </div>
    </section>

    <!-- 周次进度 -->
    <section style="margin-top:var(--space-4)">
      <div class="section-title">各周进度</div>
      <div id="weekStatsContainer">
        ${renderWeekList(weeks)}
      </div>
    </section>

    <!-- 存储情况 -->
    <section style="margin-top:var(--space-4);margin-bottom:var(--space-8)">
      <div class="section-title">存储使用</div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2)">
          <span style="font-size:var(--font-size-sm)">已用空间</span>
          <span style="font-weight:var(--font-weight-bold)">${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${storage.percent > 80 ? 'fill-red' : storage.percent > 60 ? 'fill-yellow' : ''}"
               style="width:${Math.min(storage.percent, 100)}%"></div>
        </div>
        <div style="font-size:var(--font-size-xs);color:var(--color-text-disabled);margin-top:var(--space-1)">
          ${storage.percent}% 已使用
        </div>
      </div>
    </section>
  `;
}

/**
 * 渲染最近 14 天复习柱状图（纯 CSS + div）
 */
function renderRecentChart(recent) {
  if (!recent.length) {
    return '<div class="empty-state-desc" style="padding:var(--space-4)">暂无复习记录</div>';
  }

  const maxTotal = Math.max(...recent.map(d => d.total), 1);

  // 填充到 14 天
  const today = getTodayLocal();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const dateStr = formatDate(d);
    const data = recent.find(r => r.date === dateStr);
    days.push({
      date: dateStr,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      ...( data || { correct: 0, wrong: 0, total: 0 }),
    });
  }

  const bars = days.map(d => {
    const height = Math.round((d.total / maxTotal) * 60);
    const accuracy = d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0;
    const color = d.total === 0 ? 'var(--color-divider)'
                : accuracy >= 80 ? 'var(--color-green)'
                : accuracy >= 60 ? 'var(--color-yellow)'
                : 'var(--color-red)';

    return `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="font-size:10px;color:var(--color-text-disabled)">${d.total || ''}</div>
        <div style="width:100%;height:60px;display:flex;align-items:flex-end">
          <div style="width:100%;height:${height}px;background:${color};border-radius:3px 3px 0 0;min-height:${d.total > 0 ? 4 : 0}px;transition:height var(--transition-base)"></div>
        </div>
        <div style="font-size:9px;color:var(--color-text-disabled);white-space:nowrap">${d.label}</div>
      </div>
    `;
  }).join('');

  // 图例
  const legend = `
    <div style="display:flex;gap:var(--space-4);justify-content:center;margin-top:var(--space-3)">
      <div style="display:flex;align-items:center;gap:4px;font-size:var(--font-size-xs);color:var(--color-text-secondary)">
        <div style="width:10px;height:10px;border-radius:2px;background:var(--color-green)"></div> ≥80%
      </div>
      <div style="display:flex;align-items:center;gap:4px;font-size:var(--font-size-xs);color:var(--color-text-secondary)">
        <div style="width:10px;height:10px;border-radius:2px;background:var(--color-yellow)"></div> 60-79%
      </div>
      <div style="display:flex;align-items:center;gap:4px;font-size:var(--font-size-xs);color:var(--color-text-secondary)">
        <div style="width:10px;height:10px;border-radius:2px;background:var(--color-red)"></div> &lt;60%
      </div>
    </div>
  `;

  return `
    <div style="display:flex;gap:2px;align-items:flex-end">${bars}</div>
    ${legend}
  `;
}

/**
 * 渲染周次列表（点击展开加载当周单词数）
 */
function renderWeekList(weeks) {
  if (!weeks.length) {
    return `<div class="card"><div class="empty-state-desc" style="padding:var(--space-4)">尚未添加任何周次</div></div>`;
  }

  return weeks
    .sort((a, b) => b.week_number - a.week_number)
    .map(week => `
      <div class="card" style="margin-bottom:var(--space-2)">
        <div style="display:flex;align-items:center;cursor:pointer" data-week-id="${week.id}" data-action="toggle-week">
          <div style="flex:1">
            <div style="font-weight:var(--font-weight-bold)">${esc(week.label)}</div>
            <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">
              ${week.word_count || '–'} 个单词 · 添加于 ${week.created_at?.slice(0, 10) || '–'}
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-text-disabled)">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="week-detail hidden" id="weekDetail-${week.id}"></div>
      </div>
    `).join('');
}

// ==================== 事件 ====================

function bindStatsEvents(container, weeks) {
  container.addEventListener('click', async (e) => {
    const toggleEl = e.target.closest('[data-action="toggle-week"]');
    if (!toggleEl) return;

    const weekId  = Number(toggleEl.dataset.weekId);
    const detail  = container.querySelector(`#weekDetail-${weekId}`);
    if (!detail) return;

    if (!detail.classList.contains('hidden')) {
      detail.classList.add('hidden');
      return;
    }

    detail.classList.remove('hidden');

    if (!detail.dataset.loaded) {
      detail.innerHTML = '<div style="padding:var(--space-2);color:var(--color-text-disabled);font-size:var(--font-size-sm)">加载中…</div>';
      try {
        const words = await getWordsByWeek(weekId);
        detail.innerHTML = renderWeekDetail(words);
        detail.dataset.loaded = 'true';
      } catch (err) {
        detail.innerHTML = `<div style="color:var(--color-error);font-size:var(--font-size-sm)">加载失败</div>`;
      }
    }
  });
}

function renderWeekDetail(words) {
  if (!words.length) return '<div style="padding:var(--space-2);color:var(--color-text-disabled);font-size:var(--font-size-sm)">本周暂无单词</div>';

  const items = words.map(w => `
    <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) 0;border-top:1px solid var(--color-divider)">
      <span style="flex:1;font-size:var(--font-size-sm);font-weight:var(--font-weight-bold)">${esc(w.english)}</span>
      <span style="flex:1;font-size:var(--font-size-sm);color:var(--color-text-secondary)">${esc(w.chinese)}</span>
      <span class="week-chip">${w.word_type === 'spelling' ? '会写' : '认读'}</span>
    </div>
  `).join('');

  return `<div style="margin-top:var(--space-2)">${items}</div>`;
}

// ==================== 辅助 ====================

function renderLoading() {
  return `<div class="empty-state"><div class="loading-spinner"></div></div>`;
}

function renderError(msg) {
  return `<div class="empty-state"><div class="empty-state-title" style="color:var(--color-error)">加载失败</div><div class="empty-state-desc">${esc(msg)}</div></div>`;
}

function getTodayLocal() {
  return new Date();
}

function formatDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
