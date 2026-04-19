'use strict';

import {
  getMasteryStats,
  getRecentStats,
  getAllWeeks,
  getWordsByWeek,
} from './db.js';
import { getStorageEstimate, formatBytes } from '../../shared/db.js';

export async function initStats(container) {
  container.innerHTML = '<div class="loading-spinner center-spinner"></div>';

  try {
    const [mastery, recent, weeks, storage] = await Promise.all([
      getMasteryStats(),
      getRecentStats(14),
      getAllWeeks(),
      getStorageEstimate(),
    ]);

    const weekRows = await Promise.all(
      [...weeks]
        .sort((a, b) => b.week_number - a.week_number)
        .map(async (week) => {
          const words = await getWordsByWeek(week.id);
          const basic = words.filter(word => word.word_type === 'spelling').length;
          const extended = words.length - basic;
          return { ...week, total: words.length, basic, extended };
        })
    );

    container.innerHTML = `
      <section class="stat-grid">
        <article class="stat-card accent-red">
          <div class="stat-label">红词</div>
          <div class="stat-value">${mastery.red}</div>
          <div class="stat-meta">需要优先回炉的高风险词</div>
        </article>
        <article class="stat-card accent-orange">
          <div class="stat-label">学习中</div>
          <div class="stat-value">${mastery.yellow}</div>
          <div class="stat-meta">仍需按默认曲线持续复习</div>
        </article>
        <article class="stat-card accent-green">
          <div class="stat-label">已掌握</div>
          <div class="stat-value">${mastery.green}</div>
          <div class="stat-meta">已转入低频抽查池</div>
        </article>
        <article class="stat-card accent-blue">
          <div class="stat-label">总词量</div>
          <div class="stat-value">${mastery.total}</div>
          <div class="stat-meta">持续增长时依赖固定预算抽词</div>
        </article>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">最近 14 天</div>
            <h3>任务完成记录</h3>
          </div>
        </div>
        ${renderRecentRows(recent)}
      </section>

      <section class="panel panel-list">
        <div class="section-head">
          <div>
            <div class="section-kicker">按周查看</div>
            <h3>周录入结构</h3>
          </div>
        </div>
        ${weekRows.length ? weekRows.map(row => `
          <div class="list-row">
            <div>
              <div class="list-title">${esc(row.label)}</div>
              <div class="list-meta">基础词汇 ${row.basic} · 拓展词汇 ${row.extended}</div>
            </div>
            <span class="status-pill">${row.total} 个</span>
          </div>
        `).join('') : '<div class="empty-inline">尚未录入任何周次</div>'}
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <div class="section-kicker">本地存储</div>
            <h3>数据占用</h3>
          </div>
        </div>
        <div class="list-row">
          <div>
            <div class="list-title">${formatBytes(storage.usage)}</div>
            <div class="list-meta">配额 ${formatBytes(storage.quota)} · 已使用 ${storage.percent}%</div>
          </div>
          <span class="status-pill">本地保存</span>
        </div>
      </section>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">统计加载失败</div><div class="empty-state-desc">${esc(err.message)}</div></div>`;
  }
}

function renderRecentRows(recent) {
  if (!recent.length) return '<div class="empty-inline">暂无复习记录，先生成并完成一张任务单。</div>';

  return recent
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(row => `
      <div class="list-row">
        <div>
          <div class="list-title">${esc(row.date)}</div>
          <div class="list-meta">答对 ${row.correct} · 答错 ${row.wrong}</div>
        </div>
        <span class="status-pill">${row.total} 次记录</span>
      </div>
    `).join('');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
