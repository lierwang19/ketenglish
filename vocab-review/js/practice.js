/**
 * vocab-review/js/practice.js — 练习引擎
 *
 * 负责：
 *   - 渲染题目（4选1 / 拼写 / 补全）
 *   - 处理答题交互
 *   - 调用 db.updateProgress 记录结果
 *   - 调用 scheduler.insertRehearsal 安排回炉
 *   - 任务完成后渲染结算页
 */

'use strict';

import { playFeedbackTone } from '../../shared/feedback.js';
import { updateProgress, getTodayStr, getAllWords } from './db.js';
import {
  buildDailyTask,
  insertRehearsal,
  generateOptions,
  generateFillQuestion,
  isTaskComplete,
  getAccuracyRate,
} from './scheduler.js';
import { loadSettings } from './settings.js';
// showToast：直接操作 DOM，避免与 app.js 循环依赖
function showToast(message, type = 'default') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? `toast-${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ==================== 状态 ====================

let _state = {
  task:         null,  // DailyTask
  currentIndex: 0,
  wordPool:     [],    // 全量词库（生成干扰项用）
  isAnswering:  false, // 防止重复点击
};

// ==================== 入口 ====================

/**
 * 初始化练习页面
 * @param {HTMLElement} container
 * @param {{ onComplete: Function }} options
 */
export async function initPractice(container, { onComplete } = {}) {
  container.innerHTML = renderLoading();

  try {
    const [task, allWords] = await Promise.all([
      buildDailyTask(),
      getAllWords(),
    ]);

    _state = {
      task,
      currentIndex: 0,
      wordPool: allWords,
      isAnswering: false,
      onComplete: onComplete || null,
    };

    if (!task.total) {
      container.innerHTML = renderEmptyTask();
      return;
    }

    renderQuestion(container);
  } catch (err) {
    console.error('[Practice] 初始化失败', err);
    container.innerHTML = renderError(err.message);
  }
}

// ==================== 题目渲染 ====================

function renderQuestion(container) {
  const { task, currentIndex } = _state;
  if (isTaskComplete(task)) {
    renderComplete(container);
    return;
  }

  const word = task.queue[currentIndex];
  const type = word.questionType;

  let html = '';

  // 进度条
  html += `
    <div class="practice-progress">
      <span class="practice-count">${currentIndex + 1} / ${task.total}</span>
      <div class="progress-bar" style="flex:1">
        <div class="progress-fill" style="width:${Math.round((currentIndex / task.total) * 100)}%"></div>
      </div>
    </div>
  `;

  // 题型标签
  const typeLabel = {
    pick_cn: '选择中文意思',
    pick_en: '选择英文单词',
    spell:   '拼写单词',
    fill:    '补全单词',
  }[type] || '练习';

  html += `<div class="practice-question-type">${typeLabel}${word.isRehearsal ? ' · 回炉' : ''}</div>`;

  // 题目卡片
  html += '<div class="practice-card" id="practiceCard">';

  if (type === 'pick_cn') {
    html += `
      <div class="practice-word">${esc(word.english)}</div>
      <div class="practice-hint">${word.part_of_speech ? `[${esc(word.part_of_speech)}]` : ''}</div>
    `;
    const options = generateOptions(word, _state.wordPool, 'pick_cn');
    html += renderOptions(options, word.chinese, 'pick_cn');

  } else if (type === 'pick_en') {
    html += `
      <div class="practice-word">${esc(word.chinese)}</div>
      <div class="practice-hint">${word.part_of_speech ? `[${esc(word.part_of_speech)}]` : ''}</div>
    `;
    const options = generateOptions(word, _state.wordPool, 'pick_en');
    html += renderOptions(options, word.english, 'pick_en');

  } else if (type === 'spell') {
    html += `
      <div class="practice-word">${esc(word.chinese)}</div>
      <div class="practice-hint">${word.part_of_speech ? `[${esc(word.part_of_speech)}]` : '请拼写对应的英文单词'}</div>
      <input
        type="text"
        class="spelling-input"
        id="spellingInput"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="输入英文"
      />
      <div style="margin-top:var(--space-4)">
        <button class="btn btn-primary btn-full" id="btnSubmitSpell">确认</button>
      </div>
    `;

  } else if (type === 'fill') {
    const { masked } = generateFillQuestion(word.english);
    html += `
      <div class="practice-word">${esc(word.chinese)}</div>
      <div class="practice-hint">补全单词：<strong style="font-size:var(--font-size-xl);letter-spacing:0.1em">${esc(masked)}</strong></div>
      <input
        type="text"
        class="spelling-input"
        id="spellingInput"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="输入完整单词"
        data-answer="${esc(word.english.toLowerCase())}"
      />
      <div style="margin-top:var(--space-4)">
        <button class="btn btn-primary btn-full" id="btnSubmitSpell">确认</button>
      </div>
    `;
  }

  html += '</div>'; // .practice-card

  container.innerHTML = html;

  // 绑定事件
  bindQuestionEvents(container, word, type);
}

function renderOptions(options, correctAnswer, type) {
  const btns = options.map(opt => `
    <button
      class="option-btn"
      data-answer="${esc(opt)}"
      data-correct="${esc(correctAnswer)}"
    >${esc(opt)}</button>
  `).join('');
  return `<div class="options-grid">${btns}</div>`;
}

// ==================== 事件绑定 ====================

function bindQuestionEvents(container, word, type) {
  if (type === 'pick_cn' || type === 'pick_en') {
    container.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_state.isAnswering) return;
        handleOptionAnswer(container, btn, word);
      });
    });
  } else if (type === 'spell' || type === 'fill') {
    const input = container.querySelector('#spellingInput');
    const submitBtn = container.querySelector('#btnSubmitSpell');

    if (input) {
      // 自动聚焦（延迟防止键盘遮挡）
      setTimeout(() => input.focus(), 150);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSpellingAnswer(container, input, word);
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        if (_state.isAnswering) return;
        handleSpellingAnswer(container, input, word);
      });
    }
  }
}

// ==================== 答题逻辑 ====================

async function handleOptionAnswer(container, clickedBtn, word) {
  _state.isAnswering = true;

  const userAnswer    = clickedBtn.dataset.answer;
  const correctAnswer = clickedBtn.dataset.correct;
  const isCorrect     = userAnswer === correctAnswer;

  // 视觉反馈
  clickedBtn.classList.add(isCorrect ? 'correct' : 'wrong');
  const card = container.querySelector('#practiceCard');
  card?.classList.add(isCorrect ? 'animate-correct' : 'animate-wrong');

  if (!isCorrect) {
    // 高亮正确答案
    container.querySelectorAll('.option-btn').forEach(btn => {
      if (btn.dataset.answer === correctAnswer) btn.classList.add('correct');
    });
  }

  await recordAnswer(word, isCorrect);

  setTimeout(() => {
    _state.isAnswering = false;
    nextQuestion(container);
  }, isCorrect ? 600 : 1200);
}

async function handleSpellingAnswer(container, input, word) {
  if (_state.isAnswering || !input) return;
  _state.isAnswering = true;

  const userAnswer    = input.value.trim().toLowerCase();
  const correctAnswer = (input.dataset.answer || word.english).toLowerCase();
  const isCorrect     = userAnswer === correctAnswer;

  input.classList.add(isCorrect ? 'correct' : 'wrong');

  if (!isCorrect) {
    // 显示正确答案
    const hint = container.querySelector('.practice-hint');
    if (hint) {
      hint.innerHTML = `正确答案：<strong style="color:var(--color-green)">${esc(word.english)}</strong>`;
    }
    // 禁用提交按钮
    const btn = container.querySelector('#btnSubmitSpell');
    if (btn) btn.disabled = true;
  }

  await recordAnswer(word, isCorrect);

  setTimeout(() => {
    _state.isAnswering = false;
    nextQuestion(container);
  }, isCorrect ? 600 : 1500);
}

async function recordAnswer(word, isCorrect) {
  const today = getTodayStr();
  const settings = loadSettings();

  try {
    await updateProgress(word.id, isCorrect ? 'correct' : 'wrong', today);
  } catch (err) {
    console.error('[Practice] 记录答题结果失败', err);
    showToast('记录失败，请检查存储空间', 'error');
  }

  // 更新任务统计
  const { task, currentIndex } = _state;
  task.completed++;
  if (isCorrect) {
    task.correct++;
  } else {
    task.wrong++;
    // 插入回炉题
    insertRehearsal(task.queue, word, currentIndex);
    task.total = task.queue.length;
  }

  if (settings.enableSound) {
    playFeedbackTone(isCorrect ? 'success' : 'error');
  }
}

function nextQuestion(container) {
  _state.currentIndex++;
  renderQuestion(container);
}

// ==================== 完成页 ====================

function renderComplete(container) {
  const { task } = _state;
  const accuracy = getAccuracyRate(task);

  let emoji = '🎉';
  let message = '太棒了！今日任务全部完成！';
  if (accuracy < 60) { emoji = '💪'; message = '继续努力，多复习几遍就会好的！'; }
  else if (accuracy < 80) { emoji = '👍'; message = '完成得不错，继续保持！'; }

  container.innerHTML = `
    <div class="empty-state" style="padding-top:var(--space-12)">
      <div style="font-size:64px;line-height:1">${emoji}</div>
      <div class="empty-state-title">${message}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3);width:100%;margin-top:var(--space-4)">
        <div class="stat-card">
          <div class="stat-number">${task.completed}</div>
          <div class="stat-label">完成题数</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" style="color:var(--color-green)">${task.correct}</div>
          <div class="stat-label">答对</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" style="color:var(--color-red)">${task.wrong}</div>
          <div class="stat-label">答错</div>
        </div>
      </div>

      <div class="card" style="width:100%;margin-top:var(--space-2)">
        <div style="display:flex;justify-content:space-between;margin-bottom:var(--space-2)">
          <span style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">正确率</span>
          <span style="font-weight:var(--font-weight-bold)">${accuracy}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${accuracy >= 80 ? 'fill-green' : accuracy >= 60 ? 'fill-yellow' : 'fill-red'}"
               style="width:${accuracy}%"></div>
        </div>
      </div>

      <button class="btn btn-primary btn-full" id="btnBackHome" style="margin-top:var(--space-4)">
        返回首页
      </button>
    </div>
  `;

  container.querySelector('#btnBackHome')?.addEventListener('click', () => {
    if (_state.onComplete) _state.onComplete();
  });
}

// ==================== 其他状态页 ====================

function renderLoading() {
  return `<div class="empty-state"><div class="loading-spinner"></div><div class="empty-state-desc">加载中…</div></div>`;
}

function renderEmptyTask() {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>
      </svg>
      <div class="empty-state-title">今日任务已完成！</div>
      <div class="empty-state-desc">所有单词都复习完了<br>明天继续加油</div>
    </div>
  `;
}

function renderError(msg) {
  return `
    <div class="empty-state">
      <div class="empty-state-title" style="color:var(--color-error)">加载失败</div>
      <div class="empty-state-desc">${esc(msg || '未知错误')}</div>
    </div>
  `;
}

// ==================== 工具 ====================

/** 防 XSS 转义 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
