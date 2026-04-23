/**
 * vocab-review/js/scheduler.js
 *
 * 新版每日任务单调度：
 * - 固定预算：基础词汇 / 拓展词汇分别控制数量
 * - 候选池评分：到期、逾期、错误强度、掌握层级、词汇类型共同决定优先级
 * - 小范围加权抽样：避免纯排序导致后排单词长期见不到
 */

'use strict';

import {
  getAllWords,
  getDueWords,
  getDailyTask,
  saveDailyTask,
  getTodayStr,
  calcNextReviewDate,
} from './db.js';
import { DEFAULT_SETTINGS } from './settings.js';

export async function buildDailyTask(settings = {}, force = false) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const today = getTodayStr();

  if (!force) {
    const existing = await getDailyTask(today);
    if (existing?.sections) return existing;
  }

  // 主候选：到期的词（走 next_review_at 索引，避免全表扫描）
  const dueWords = await getDueWords(today);
  const pool = dueWords.filter(w => w.progress);

  // 抽查池：按"基础/拓展"分别判断到期数是否够填满本类型预算。
  // 任一类型不够（或开启了绿色低频抽查），就回退到全表扫描补"未来候选"。
  // 修复 codex 发现的回归：原先按总数判断，会在两种类型严重偏科时让某栏空掉。
  const dueBasicCount = pool.filter(w => w.word_type === 'spelling').length;
  const dueExtendedCount = pool.length - dueBasicCount;
  const basicNeedsFallback = dueBasicCount < (cfg.basicDailyCount || 0) * 1.5;
  const extendedNeedsFallback = dueExtendedCount < (cfg.extendedDailyCount || 0) * 1.5;
  const needSpotCheck = cfg.enableLowFrequencyCheck || basicNeedsFallback || extendedNeedsFallback;
  if (needSpotCheck) {
    const dueIds = new Set(pool.map(w => w.id));
    const allWords = await getAllWords();
    for (const w of allWords) {
      if (!w.progress || dueIds.has(w.id)) continue;
      pool.push(w);
    }
  }

  const candidates = pool
    .map(word => ({ ...word, score: scoreWord(word, today, cfg) }))
    .filter(word => word.score > 0);

  const basicCandidates = candidates.filter(word => word.word_type === 'spelling');
  const extendedCandidates = candidates.filter(word => word.word_type !== 'spelling');

  const selectedBasic = pickWords(basicCandidates, cfg.basicDailyCount);
  const selectedExtended = pickWords(extendedCandidates, cfg.extendedDailyCount);

  const task = {
    date: today,
    status: 'generated',
    generated_at: new Date().toISOString(),
    summary: {
      basicCount: selectedBasic.length,
      extendedCount: selectedExtended.length,
      totalWords: selectedBasic.length + selectedExtended.length,
      reminderTime: cfg.reminderTime,
    },
    sections: {
      basic: buildBasicSection(selectedBasic),
      extended: buildExtendedSection(selectedExtended),
    },
    meta: {
      scoringModel: 'budgeted-priority-pool',
      selectedBasicIds: selectedBasic.map(item => item.id),
      selectedExtendedIds: selectedExtended.map(item => item.id),
      breakdown: buildBreakdown(selectedBasic, selectedExtended, today),
    },
  };

  await saveDailyTask(today, task);
  return task;
}

export function scoreWord(word, today, settings = DEFAULT_SETTINGS) {
  const progress = word.progress || {};
  const type = word.word_type === 'spelling' ? 'basic' : 'extended';
  const nextReview = progress.next_review_at || today;
  const overdueDays = diffDays(nextReview, today);
  const due = overdueDays >= 0;

  let score = 0;

  if (due) {
    score += 50;
    score += Math.min(overdueDays * 4, 28);
  }

  score += type === 'basic' ? 18 : 8;
  score += masteryWeight(progress.mastery_level);
  score += Math.min((progress.total_wrong || 0) * 4, 24);

  if (progress.is_error_word) score += 22;
  if ((progress.error_count_today || 0) > 0) score += 8;

  const consecutiveCorrect = progress.consecutive_correct || 0;
  score -= Math.min(consecutiveCorrect * 3, 15);

  const lastReviewed = progress.last_reviewed_at;
  if (lastReviewed) {
    const daysSinceReview = diffDays(lastReviewed, today);
    if (daysSinceReview <= 1) score -= 14;
    else if (daysSinceReview <= 3) score -= 6;
  }

  if (!due) {
    const futureGap = Math.abs(overdueDays);
    score -= Math.min(futureGap * 6, 30);
  }

  if (progress.mastery_level === 'green' && !settings.enableLowFrequencyCheck) {
    score -= 20;
  }

  return Math.max(score, 0);
}

function buildBasicSection(words) {
  const midpoint = Math.ceil(words.length / 2);
  const left = words.slice(0, midpoint).map((word, index) => ({
    seq: index + 1,
    prompt: word.chinese,
    answer: word.english,
    direction: 'cn_to_en',
    wordId: word.id,
  }));
  const right = words.slice(midpoint).map((word, index) => ({
    seq: midpoint + index + 1,
    prompt: word.english,
    answer: word.chinese,
    direction: 'en_to_cn',
    wordId: word.id,
  }));

  return { total: words.length, left, right };
}

function buildExtendedSection(words) {
  const midpoint = Math.ceil(words.length / 2);
  const left = words.slice(0, midpoint).map((word, index) => ({
    seq: index + 1,
    english: word.english,
    chinese: word.chinese,
    mark: '',
    wordId: word.id,
  }));
  const right = words.slice(midpoint).map((word, index) => ({
    seq: midpoint + index + 1,
    english: word.english,
    chinese: word.chinese,
    mark: '',
    wordId: word.id,
  }));

  return { total: words.length, left, right };
}

function buildBreakdown(basicWords, extendedWords, today) {
  const all = [...basicWords, ...extendedWords];
  return {
    overdue: all.filter(word => diffDays(word.progress?.next_review_at || today, today) > 0).length,
    dueToday: all.filter(word => diffDays(word.progress?.next_review_at || today, today) === 0).length,
    errorWords: all.filter(word => word.progress?.is_error_word).length,
    greenSpotChecks: all.filter(word => word.progress?.mastery_level === 'green').length,
  };
}

function pickWords(candidates, limit) {
  if (limit <= 0 || !candidates.length) return [];

  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.english).localeCompare(String(b.english));
  });

  const guaranteed = sorted.slice(0, Math.min(limit, Math.ceil(limit * 0.6)));
  const remainingSlots = limit - guaranteed.length;

  if (remainingSlots <= 0) return guaranteed;

  const pool = sorted.slice(guaranteed.length, Math.min(sorted.length, guaranteed.length + remainingSlots * 3));
  const randomPicks = weightedPick(pool, remainingSlots);
  return [...guaranteed, ...randomPicks];
}

function weightedPick(pool, count) {
  const source = [...pool];
  const result = [];

  while (source.length && result.length < count) {
    const total = source.reduce((sum, item) => sum + Math.max(item.score, 1), 0);
    let cursor = Math.random() * total;

    for (let i = 0; i < source.length; i++) {
      cursor -= Math.max(source[i].score, 1);
      if (cursor <= 0) {
        result.push(source[i]);
        source.splice(i, 1);
        break;
      }
    }
  }

  return result;
}

function masteryWeight(level) {
  switch (level) {
    case 'red': return 18;
    case 'yellow': return 10;
    case 'green': return 2;
    default: return 6;
  }
}

function diffDays(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export function describeNextReview(word, settings = DEFAULT_SETTINGS) {
  const type = word.word_type === 'spelling' ? 'basic' : 'extended';
  const intervals = type === 'basic' ? settings.basicIntervals : settings.extendedIntervals;
  const progress = word.progress || {};
  const idx = Math.min(progress.interval_index || 0, intervals.length - 1);
  const nextGap = intervals[idx] ?? intervals[intervals.length - 1];
  return calcNextReviewDate(getTodayStr(), nextGap);
}
