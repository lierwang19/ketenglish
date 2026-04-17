/**
 * vocab-review/js/scheduler.js — 每日任务调度算法
 *
 * 优先级顺序（由高到低）：
 *   P1. 到期红词（mastery=red, due today）
 *   P2. 到期黄词（mastery=yellow, due today）
 *   P3. 到期会写词（word_type=spelling, due today）
 *   P4. 错词回炉（is_error_word=true, not yet due）
 *   P5. 绿色词抽查（mastery=green, due today or overdue）
 *
 * 每日任务量上限：由设置控制（默认 30 题），防止随周数增加无限膨胀
 *
 * CRITICAL FIX 列表（对应 plan.md 工程审查结论）：
 *   [CF-1] 幂等性 — 同一天多次调用 buildDailyTask，结果一致（用 daily_tasks 快照）
 *   [CF-2] consecutive_correct 归零 — 答错时在 db.js updateProgress 处理，此处不重复
 *   [CF-3] 日期算术 — 使用 calcNextReviewDate（本地日历天），不用毫秒
 *   [CF-4] 原子事务 — 批量写入在 db.js 单一事务内完成
 */

'use strict';

import {
  getDueWords,
  getErrorWords,
  getDailyTask,
  saveDailyTask,
  getTodayStr,
  resetSessionId,
} from './db.js';

// ==================== 配置 ====================

export const DEFAULT_SETTINGS = {
  maxDailyQuestions:   30,   // 每日最多题数
  maxErrorRehearsal:    5,   // 错词回炉最多题数
  maxGreenSpotCheck:    3,   // 绿词抽查最多题数
  enableSpotCheck:   true,   // 是否开启绿词抽查
};

// ==================== 构建每日任务 ====================

/**
 * 构建今日任务列表（幂等 — 同一天调用结果相同）
 *
 * @param {object} settings  — 覆盖 DEFAULT_SETTINGS 的设置项
 * @returns {Promise<DailyTask>}
 *
 * @typedef {object} DailyTask
 * @property {string}   date          - YYYY-MM-DD
 * @property {WordItem[]} queue        - 有序题目队列（含回炉词）
 * @property {number}   total          - 队列总题数
 * @property {object}   breakdown      - { red, yellow, spelling, error, green }
 */
export async function buildDailyTask(settings = {}) {
  const cfg   = { ...DEFAULT_SETTINGS, ...settings };
  const today = getTodayStr();

  // [CF-1] 幂等性：同一天已有快照则直接返回
  const existing = await getDailyTask(today);
  if (existing?.queue?.length > 0) {
    return existing;
  }

  // 重置 session ID，每次新任务用新 session
  resetSessionId();

  // 拉取数据
  const [dueWords, errorWords] = await Promise.all([
    getDueWords(today),
    getErrorWords(),
  ]);

  // 按优先级分桶
  const redWords     = dueWords.filter(w => w.progress.mastery_level === 'red');
  const yellowWords  = dueWords.filter(w => w.progress.mastery_level === 'yellow');
  const spellingWords = dueWords.filter(w =>
    w.word_type === 'spelling' && w.progress.mastery_level !== 'red'
  );
  const greenWords   = dueWords.filter(w => w.progress.mastery_level === 'green');

  // 到期的错词（not in dueWords，是额外回炉）
  const dueWordIds   = new Set(dueWords.map(w => w.id));
  const rehearsalWords = errorWords
    .filter(w => !dueWordIds.has(w.id))
    .slice(0, cfg.maxErrorRehearsal);

  const greenSpotCheck = cfg.enableSpotCheck
    ? greenWords.slice(0, cfg.maxGreenSpotCheck)
    : [];

  // 组装有序队列（按优先级排序）
  let queue = [
    ...redWords,
    ...yellowWords,
    ...spellingWords,
    ...rehearsalWords,
    ...greenSpotCheck,
  ];

  // 截断到上限
  queue = queue.slice(0, cfg.maxDailyQuestions);

  // 题型标注（供 practice.js 生成题目）
  queue = queue.map(w => ({
    ...w,
    questionType: resolveQuestionType(w),
  }));

  const breakdown = {
    red:      redWords.length,
    yellow:   yellowWords.length,
    spelling: spellingWords.length,
    error:    rehearsalWords.length,
    green:    greenSpotCheck.length,
  };

  const task = {
    date:         today,
    queue,
    total:        queue.length,
    breakdown,
    completed:    0,
    correct:      0,
    wrong:        0,
    generated_at: new Date().toISOString(),
  };

  // 保存快照（[CF-1] 幂等保障）
  await saveDailyTask(today, task);

  return task;
}

// ==================== 题型决策 ====================

/**
 * 根据单词类型和掌握等级决定题型
 *
 * 认读词 (recognition):
 *   - 看英文选中文
 *   - 看中文选英文（交替出现）
 *
 * 会写词 (spelling):
 *   - 看中文拼英文（绿色前）
 *   - 补全单词（缺字母）（黄/绿阶段增加）
 *
 * @returns {'pick_cn'|'pick_en'|'spell'|'fill'}
 */
export function resolveQuestionType(word) {
  const { word_type, progress } = word;
  const mastery = progress?.mastery_level || 'red';

  if (word_type === 'spelling') {
    // 会写词：红/黄 用拼写，绿色用补全（巩固）
    if (mastery === 'green') return 'fill';
    return 'spell';
  }

  // 认读词：交替看英选中 / 看中选英
  // 用 word.id 的奇偶性决定题型，确保同一词每次呈现类型稳定
  return (word.id % 2 === 0) ? 'pick_cn' : 'pick_en';
}

// ==================== 回炉插入 ====================

/**
 * 当日答错的词，在任务后半段插入回炉题
 * practice.js 在答错时调用此函数，将词追加到队列末尾（最多回炉 2 次）
 *
 * @param {WordItem[]} queue   - 当前题目队列（可变）
 * @param {WordItem}   word    - 答错的词
 * @param {number}     currentIndex - 当前做到第几题
 */
export function insertRehearsal(queue, word, currentIndex) {
  // 统计该词在当前队列剩余部分的出现次数
  const remaining = queue.slice(currentIndex + 1);
  const alreadyQueued = remaining.filter(w => w.id === word.id).length;

  if (alreadyQueued >= 2) return; // 最多回炉 2 次，防止无限循环

  // 插入位置：剩余队列的中后段（约 2/3 处），不要立即出现
  const insertAt = Math.min(
    currentIndex + 1 + Math.max(3, Math.floor(remaining.length * 0.5)),
    queue.length
  );

  queue.splice(insertAt, 0, {
    ...word,
    questionType: resolveQuestionType(word),
    isRehearsal:  true,
  });
}

// ==================== 连续答对追踪 ====================

/**
 * 检查是否应该显示"任务完成"庆祝动画
 * @param {DailyTask} task
 * @returns {boolean}
 */
export function isTaskComplete(task) {
  return task.completed >= task.total && task.total > 0;
}

/**
 * 获取当日正确率
 */
export function getAccuracyRate(task) {
  if (!task.completed) return 0;
  return Math.round((task.correct / task.completed) * 100);
}

// ==================== 抽查干扰项生成 ====================

/**
 * 为选择题生成 3 个干扰项
 * 从 allWords 中随机取，不与正确答案重复
 *
 * @param {WordItem} correct    - 正确词
 * @param {WordItem[]} pool     - 全量词库（用于取干扰项）
 * @param {'pick_cn'|'pick_en'} type
 * @returns {string[]}          - 4 个选项（含正确答案，已打乱）
 */
export function generateOptions(correct, pool, type) {
  const correctAnswer = type === 'pick_cn' ? correct.chinese : correct.english;

  // 从 pool 中过滤掉自己，取干扰项
  const distractors = pool
    .filter(w => w.id !== correct.id)
    .map(w => type === 'pick_cn' ? w.chinese : w.english)
    .filter(ans => ans !== correctAnswer); // 防止语义相同

  // 随机取 3 个
  const shuffled = fisherYatesShuffle([...new Set(distractors)]);
  const selected = shuffled.slice(0, 3);

  // 如果词库太小，用 fallback 补齐
  while (selected.length < 3) {
    selected.push(type === 'pick_cn' ? '（无）' : 'n/a');
  }

  // 混入正确答案并打乱
  const options = fisherYatesShuffle([correctAnswer, ...selected]);
  return options;
}

/**
 * 生成补全单词题的带空格版本
 * 随机隐藏 2~3 个字母（用下划线替代）
 *
 * @param {string} english  - 完整英文单词
 * @returns {{ masked: string, answer: string, positions: number[] }}
 */
export function generateFillQuestion(english) {
  const word = english.toLowerCase();
  const len  = word.length;

  // 至少保留一半字母可见
  const hideCount = Math.min(3, Math.max(1, Math.floor(len * 0.4)));
  const positions = new Set();

  // 不隐藏首字母
  while (positions.size < hideCount) {
    const pos = 1 + Math.floor(Math.random() * (len - 1));
    positions.add(pos);
  }

  const masked = word
    .split('')
    .map((ch, i) => positions.has(i) ? '_' : ch)
    .join('');

  return { masked, answer: word, positions: [...positions].sort() };
}

// ==================== 工具 ====================

function fisherYatesShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
