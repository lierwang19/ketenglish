/**
 * vocab-review/js/db.js — 系统A 数据层
 *
 * Schema:
 *   words            — 单词主表
 *   word_progress    — 学习进度（每词一条）
 *   review_logs      — 复习日志
 *   weekly_batches   — 周次管理
 *   daily_tasks      — 每日任务快照
 *
 * 版本历史:
 *   v1 — 初始 Schema
 */

'use strict';

import { openDatabase, withTransaction, promisifyRequest, getAll, cursorGetAll } from '../../shared/db.js';

const DB_NAME    = 'ket-vocab';
const DB_VERSION = 1;

// 命名分层约定（不要混用）：
//   DB 层（words.word_type）   : 'recognition' | 'spelling'
//   调度器/UI 层               : 'extended'    | 'basic'
//   两者一一对应：spelling ↔ basic, recognition ↔ extended
//   修改任一层都要同步另一层（grep 'word_type' 与 grep 'basic\\|extended'）

let _db = null;

// ==================== Schema 定义 ====================

function onUpgrade(db, oldVersion /*, newVersion, tx */) {
  if (oldVersion < 1) {
    // words — 单词主表
    const words = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
    words.createIndex('english',    'english',    { unique: false }); // 英文（可能同形异义）
    words.createIndex('week_id',    'week_id',    { unique: false }); // 所属周次
    words.createIndex('word_type',  'word_type',  { unique: false }); // 'recognition'|'spelling'
    words.createIndex('created_at', 'created_at', { unique: false });

    // word_progress — 每词进度（与 words 1:1）
    const progress = db.createObjectStore('word_progress', { keyPath: 'word_id' });
    progress.createIndex('mastery_level',   'mastery_level',   { unique: false }); // 'red'|'yellow'|'green'
    progress.createIndex('next_review_at',  'next_review_at',  { unique: false }); // YYYY-MM-DD
    progress.createIndex('due_review',      'due_review',      { unique: false }); // 复合筛选辅助字段

    // review_logs — 复习日志
    const logs = db.createObjectStore('review_logs', { keyPath: 'id', autoIncrement: true });
    logs.createIndex('word_id',     'word_id',     { unique: false });
    logs.createIndex('reviewed_at', 'reviewed_at', { unique: false }); // YYYY-MM-DD
    logs.createIndex('session_id',  'session_id',  { unique: false }); // 同一 session 批量写入

    // weekly_batches — 周次管理
    const batches = db.createObjectStore('weekly_batches', { keyPath: 'id', autoIncrement: true });
    batches.createIndex('week_number', 'week_number', { unique: true });
    batches.createIndex('created_at',  'created_at',  { unique: false });

    // daily_tasks — 每日任务快照
    const tasks = db.createObjectStore('daily_tasks', { keyPath: 'date' }); // date = YYYY-MM-DD
    tasks.createIndex('generated_at', 'generated_at', { unique: false });
  }
}

// ==================== 初始化 ====================

export async function initDB() {
  if (_db) return _db;
  _db = await openDatabase(DB_NAME, DB_VERSION, onUpgrade);
  return _db;
}

export function getDB() {
  if (!_db) throw new Error('[VocabDB] 数据库未初始化，请先调用 initDB()');
  return _db;
}

// ==================== weekly_batches ====================

/**
 * 创建或获取周次
 */
export async function upsertWeek(weekNumber, label) {
  const db = getDB();
  return withTransaction(db, 'weekly_batches', 'readwrite', async ({ weekly_batches }) => {
    const existing = await promisifyRequest(
      weekly_batches.index('week_number').get(weekNumber)
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const id = await promisifyRequest(
      weekly_batches.add({
        week_number: weekNumber,
        label: label || `第${weekNumber}周`,
        word_count: 0,
        created_at: now,
        updated_at: now,
      })
    );
    return { id, week_number: weekNumber, label };
  });
}

export async function getAllWeeks() {
  const db = getDB();
  return withTransaction(db, 'weekly_batches', 'readonly', ({ weekly_batches }) =>
    getAll(weekly_batches)
  );
}

/**
 * 重命名周次（只改 label）
 */
export async function renameWeek(weekId, label) {
  const db = getDB();
  return withTransaction(db, 'weekly_batches', 'readwrite', async ({ weekly_batches }) => {
    const existing = await promisifyRequest(weekly_batches.get(weekId));
    if (!existing) throw new Error(`周次不存在：${weekId}`);
    const next = { ...existing, label: String(label || '').trim() || existing.label, updated_at: new Date().toISOString() };
    await promisifyRequest(weekly_batches.put(next));
    return next;
  });
}

/**
 * 清空指定周次下的所有单词（words + word_progress + review_logs），但保留周次本身。
 * 用于"录错重录"场景。
 */
export async function clearWeekWords(weekId) {
  const db = getDB();
  return withTransaction(db, ['words', 'word_progress', 'review_logs'], 'readwrite',
    async ({ words, word_progress, review_logs }) => {
      const rows = await cursorGetAll(words.index('week_id'), IDBKeyRange.only(weekId));
      let deleted = 0;
      for (const w of rows) {
        await promisifyRequest(words.delete(w.id));
        await promisifyRequest(word_progress.delete(w.id));
        const logs = await cursorGetAll(review_logs.index('word_id'), IDBKeyRange.only(w.id));
        for (const log of logs) {
          await promisifyRequest(review_logs.delete(log.id));
        }
        deleted++;
      }
      return { deleted };
    }
  );
}

/**
 * 删除整个周次（连带其所有单词、进度、日志）
 * 必须单事务原子完成，避免出现"周次已删但词残留"或"词删完但周次还在"的中间态。
 */
export async function deleteWeek(weekId) {
  const db = getDB();
  return withTransaction(
    db,
    ['words', 'word_progress', 'review_logs', 'weekly_batches'],
    'readwrite',
    async ({ words, word_progress, review_logs, weekly_batches }) => {
      const rows = await cursorGetAll(words.index('week_id'), IDBKeyRange.only(weekId));
      let deleted = 0;
      for (const w of rows) {
        await promisifyRequest(words.delete(w.id));
        await promisifyRequest(word_progress.delete(w.id));
        const logs = await cursorGetAll(review_logs.index('word_id'), IDBKeyRange.only(w.id));
        for (const log of logs) {
          await promisifyRequest(review_logs.delete(log.id));
        }
        deleted++;
      }
      await promisifyRequest(weekly_batches.delete(weekId));
      return { deleted };
    }
  );
}

// ==================== words ====================

/**
 * 批量写入单词（同一事务，原子性）
 * 去重规则：同一 week_id 下，english（lowercase + trim）相同视为同一词，跳过
 *
 * @param {Array<{english, chinese, part_of_speech, word_type, week_id}>} wordList
 * @returns {Promise<{ inserted: number[], skipped: Array<{english, week_id}> }>}
 */
export async function addWords(wordList) {
  if (!wordList?.length) return { inserted: [], skipped: [] };
  const db = getDB();

  return withTransaction(db, ['words', 'word_progress'], 'readwrite', async ({ words, word_progress }) => {
    const now  = new Date().toISOString();
    const today = getTodayStr();
    const inserted = [];
    const skipped = [];

    // 拉一次同周次现有单词集合，避免每个词单独走索引
    const existingByWeek = new Map();

    for (const w of wordList) {
      const english = String(w.english || '').trim().toLowerCase();
      const chinese = String(w.chinese || '').trim();
      const weekId  = w.week_id;
      if (!english || !chinese || !weekId) {
        skipped.push({ english, week_id: weekId, reason: 'invalid' });
        continue;
      }

      // 懒加载该周次已有单词（按 english 建集合）
      if (!existingByWeek.has(weekId)) {
        const rows = await cursorGetAll(words.index('week_id'), IDBKeyRange.only(weekId));
        existingByWeek.set(weekId, new Set(rows.map(r => String(r.english || '').toLowerCase())));
      }
      const set = existingByWeek.get(weekId);
      if (set.has(english)) {
        skipped.push({ english, week_id: weekId, reason: 'duplicate' });
        continue;
      }

      const id = await promisifyRequest(
        words.add({
          english,
          chinese,
          part_of_speech: w.part_of_speech || '',
          word_type:      w.word_type || 'recognition',
          week_id:        weekId,
          created_at:     now,
        })
      );
      inserted.push(id);
      set.add(english);

      await promisifyRequest(
        word_progress.add({
          word_id:            id,
          mastery_level:      'red',
          consecutive_correct: 0,
          interval_index:     0,
          next_review_at:     today,
          last_reviewed_at:   null,
          total_correct:      0,
          total_wrong:        0,
          is_error_word:      false,
          error_count_today:  0,
          created_at:         now,
          updated_at:         now,
        })
      );
    }

    return { inserted, skipped };
  });
}

/**
 * 修改单词文本（不影响进度）
 * 适合修拼写错误、订正中文释义。
 * 注意：english 改后会再次小写 + trim；如果与同周次已有词重复会抛错。
 */
export async function updateWord(wordId, patch) {
  const db = getDB();
  return withTransaction(db, 'words', 'readwrite', async ({ words }) => {
    const existing = await promisifyRequest(words.get(wordId));
    if (!existing) throw new Error(`[VocabDB] word not found: ${wordId}`);

    const next = { ...existing };
    if (patch.english !== undefined) next.english = String(patch.english).trim().toLowerCase();
    if (patch.chinese !== undefined) next.chinese = String(patch.chinese).trim();
    if (patch.part_of_speech !== undefined) next.part_of_speech = patch.part_of_speech || '';
    if (patch.word_type !== undefined) next.word_type = patch.word_type;
    next.updated_at = new Date().toISOString();

    // 同周次重名校验（排除自身）
    if (patch.english !== undefined && next.english !== existing.english) {
      const sameWeek = await cursorGetAll(words.index('week_id'), IDBKeyRange.only(next.week_id));
      const conflict = sameWeek.find(w => w.id !== wordId && String(w.english).toLowerCase() === next.english);
      if (conflict) throw new Error(`同周已存在单词：${next.english}`);
    }

    await promisifyRequest(words.put(next));
    return next;
  });
}

/**
 * 查询所有单词（含进度）
 */
export async function getAllWords() {
  const db = getDB();
  const [words, progresses] = await Promise.all([
    withTransaction(db, 'words', 'readonly', ({ words }) => getAll(words)),
    withTransaction(db, 'word_progress', 'readonly', ({ word_progress }) => getAll(word_progress)),
  ]);

  const progressMap = new Map(progresses.map(p => [p.word_id, p]));
  return words.map(w => ({ ...w, progress: progressMap.get(w.id) || null }));
}

/**
 * 按周次查询单词
 */
export async function getWordsByWeek(weekId) {
  const db = getDB();
  return withTransaction(db, 'words', 'readonly', ({ words }) =>
    cursorGetAll(words.index('week_id'), IDBKeyRange.only(weekId))
  );
}

/**
 * 删除单词（同时删除进度和日志）
 */
export async function deleteWord(wordId) {
  const db = getDB();
  return withTransaction(db, ['words', 'word_progress', 'review_logs'], 'readwrite',
    async ({ words, word_progress, review_logs }) => {
      await promisifyRequest(words.delete(wordId));
      await promisifyRequest(word_progress.delete(wordId));
      // 删除关联日志
      const logs = await cursorGetAll(review_logs.index('word_id'), IDBKeyRange.only(wordId));
      for (const log of logs) {
        await promisifyRequest(review_logs.delete(log.id));
      }
    }
  );
}

// ==================== word_progress ====================

/**
 * 获取某词进度
 */
export async function getProgress(wordId) {
  const db = getDB();
  return withTransaction(db, 'word_progress', 'readonly', ({ word_progress }) =>
    promisifyRequest(word_progress.get(wordId))
  );
}

/**
 * 获取今日到期的单词（next_review_at <= today）
 * 返回带 word 数据的合并对象
 */
export async function getDueWords(today) {
  const db = getDB();
  const dateStr = today || getTodayStr();

  // 用游标遍历 next_review_at <= today 的所有进度记录
  const dueProgresses = await withTransaction(db, 'word_progress', 'readonly', ({ word_progress }) =>
    cursorGetAll(
      word_progress.index('next_review_at'),
      IDBKeyRange.upperBound(dateStr)
    )
  );

  if (!dueProgresses.length) return [];

  // 批量拉取对应的 word 记录（同事务内并发触发，避免 N 次串行 roundtrip）
  const wordIds = dueProgresses.map(p => p.word_id);
  const words = await withTransaction(db, 'words', 'readonly', ({ words: store }) =>
    Promise.all(wordIds.map(id => promisifyRequest(store.get(id))))
  );

  const wordMap = new Map(words.filter(Boolean).map(w => [w.id, w]));
  return dueProgresses
    .filter(p => wordMap.has(p.word_id))
    .map(p => ({ ...wordMap.get(p.word_id), progress: p }));
}

/**
 * 更新单词进度（答对/答错后调用）
 * @param {number} wordId
 * @param {'correct'|'wrong'} result
 * @param {string} today  YYYY-MM-DD
 */
export async function updateProgress(wordId, result, today) {
  const db = getDB();
  const dateStr = today || getTodayStr();

  return withTransaction(db, ['word_progress', 'review_logs'], 'readwrite',
    async ({ word_progress, review_logs }) => {
      const p = await promisifyRequest(word_progress.get(wordId));
      if (!p) throw new Error(`[VocabDB] word_progress not found: ${wordId}`);

      const sessionId = getSessionId();

      if (result === 'correct') {
        const newConsecutive = p.consecutive_correct + 1;
        const { mastery, intervalIndex } = advanceMastery(
          p.mastery_level,
          p.interval_index,
          newConsecutive
        );
        const nextReview = calcNextReviewDate(dateStr, INTERVALS[intervalIndex]);

        await promisifyRequest(
          word_progress.put({
            ...p,
            mastery_level:       mastery,
            consecutive_correct: newConsecutive,
            interval_index:      intervalIndex,
            next_review_at:      nextReview,
            last_reviewed_at:    dateStr,
            total_correct:       p.total_correct + 1,
            error_count_today:   p.error_count_today,  // 不重置，保留今日错误记录
            updated_at:          new Date().toISOString(),
          })
        );
      } else {
        // 答错：回到红色，consecutive_correct 归零，次日重新复习
        await promisifyRequest(
          word_progress.put({
            ...p,
            mastery_level:       'red',
            consecutive_correct: 0,       // CRITICAL FIX: 归零
            interval_index:      0,
            next_review_at:      calcNextReviewDate(dateStr, 1), // 次日
            last_reviewed_at:    dateStr,
            total_wrong:         p.total_wrong + 1,
            is_error_word:       true,     // 进入错词本
            error_count_today:   p.error_count_today + 1,
            updated_at:          new Date().toISOString(),
          })
        );
      }

      // 写复习日志
      await promisifyRequest(
        review_logs.add({
          word_id:     wordId,
          result,
          reviewed_at: dateStr,
          session_id:  sessionId,
          created_at:  new Date().toISOString(),
        })
      );
    }
  );
}

/**
 * 重置今日错误计数（每日任务开始时调用，避免跨日累积）
 */
export async function resetDailyErrorCounts() {
  const db = getDB();
  return withTransaction(db, 'word_progress', 'readwrite', async ({ word_progress }) => {
    const all = await getAll(word_progress);
    for (const p of all) {
      if (p.error_count_today !== 0) {
        await promisifyRequest(
          word_progress.put({ ...p, error_count_today: 0 })
        );
      }
    }
  });
}

// ==================== daily_tasks ====================

/**
 * 保存每日任务快照
 */
export async function saveDailyTask(date, taskData) {
  const db = getDB();
  return withTransaction(db, 'daily_tasks', 'readwrite', ({ daily_tasks }) =>
    promisifyRequest(
      daily_tasks.put({
        date,
        ...taskData,
        generated_at: new Date().toISOString(),
      })
    )
  );
}

/**
 * 获取某日任务快照
 */
export async function getDailyTask(date) {
  const db = getDB();
  return withTransaction(db, 'daily_tasks', 'readonly', ({ daily_tasks }) =>
    promisifyRequest(daily_tasks.get(date))
  );
}

export async function updateDailyTask(date, patch) {
  const db = getDB();
  return withTransaction(db, 'daily_tasks', 'readwrite', async ({ daily_tasks }) => {
    const existing = await promisifyRequest(daily_tasks.get(date));
    const next = {
      ...(existing || { date }),
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await promisifyRequest(daily_tasks.put(next));
    return next;
  });
}

export async function listDailyTasks() {
  const db = getDB();
  const tasks = await withTransaction(db, 'daily_tasks', 'readonly', ({ daily_tasks }) => getAll(daily_tasks));
  return tasks.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ==================== 统计查询 ====================

/**
 * 获取总体掌握统计
 * @returns {Promise<{red: number, yellow: number, green: number, total: number}>}
 */
export async function getMasteryStats() {
  const db = getDB();
  const all = await withTransaction(db, 'word_progress', 'readonly', ({ word_progress }) =>
    getAll(word_progress)
  );

  const stats = { red: 0, yellow: 0, green: 0, total: all.length };
  for (const p of all) {
    stats[p.mastery_level] = (stats[p.mastery_level] || 0) + 1;
  }
  return stats;
}

/**
 * 获取错词本（is_error_word = true）
 */
export async function getErrorWords() {
  const db = getDB();
  const progresses = await withTransaction(db, 'word_progress', 'readonly', ({ word_progress }) =>
    cursorGetAll(word_progress)
  );

  const errorProgresses = progresses.filter(p => p.is_error_word);
  if (!errorProgresses.length) return [];

  const wordIds = errorProgresses.map(p => p.word_id);
  const words = await withTransaction(db, 'words', 'readonly', ({ words: store }) =>
    Promise.all(wordIds.map(id => promisifyRequest(store.get(id))))
  );

  const wordMap = new Map(words.filter(Boolean).map(w => [w.id, w]));
  return errorProgresses
    .filter(p => wordMap.has(p.word_id))
    .map(p => ({ ...wordMap.get(p.word_id), progress: p }));
}

/**
 * 从错词本移除（手动标记为已掌握）
 */
export async function clearErrorWord(wordId) {
  const db = getDB();
  return withTransaction(db, 'word_progress', 'readwrite', async ({ word_progress }) => {
    const p = await promisifyRequest(word_progress.get(wordId));
    if (p) {
      await promisifyRequest(
        word_progress.put({ ...p, is_error_word: false, updated_at: new Date().toISOString() })
      );
    }
  });
}

/**
 * 获取最近 N 天的复习日志统计
 */
export async function getRecentStats(days = 14) {
  const db = getDB();
  const today = getTodayStr();
  const startDate = calcNextReviewDate(today, -days + 1);

  const logs = await withTransaction(db, 'review_logs', 'readonly', ({ review_logs }) =>
    cursorGetAll(
      review_logs.index('reviewed_at'),
      IDBKeyRange.bound(startDate, today)
    )
  );

  // 按日期聚合
  const byDate = {};
  for (const log of logs) {
    if (!byDate[log.reviewed_at]) {
      byDate[log.reviewed_at] = { date: log.reviewed_at, correct: 0, wrong: 0, total: 0 };
    }
    byDate[log.reviewed_at].total++;
    byDate[log.reviewed_at][log.result]++;
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

// ==================== 间隔复习算法 ====================

/** 复习间隔天数列表 — 0/1/3/7/14/30 */
export const INTERVALS = [0, 1, 3, 7, 14, 30];

/**
 * 根据当前状态推进掌握等级和间隔
 * CRITICAL FIX: 不在此处重置 consecutive_correct；由调用方传入新值
 *
 * @param {'red'|'yellow'|'green'} currentMastery
 * @param {number} currentIntervalIdx
 * @param {number} newConsecutive  — 答对后已递增的连续正确次数
 * @returns {{ mastery: string, intervalIndex: number }}
 */
function advanceMastery(currentMastery, currentIntervalIdx, newConsecutive) {
  let mastery = currentMastery;
  let intervalIndex = Math.min(currentIntervalIdx + 1, INTERVALS.length - 1);

  // 掌握等级晋升逻辑
  if (mastery === 'red' && newConsecutive >= 2) {
    mastery = 'yellow';
  } else if (mastery === 'yellow' && newConsecutive >= 4) {
    mastery = 'green';
  }

  return { mastery, intervalIndex };
}

/**
 * 计算下次复习日期
 * CRITICAL FIX: 基于日历天数，不用毫秒计算，避免夏令时/时区问题
 *
 * @param {string} fromDate   YYYY-MM-DD
 * @param {number} days       间隔天数
 * @returns {string}          YYYY-MM-DD
 */
export function calcNextReviewDate(fromDate, days) {
  const [y, m, d] = fromDate.split('-').map(Number);
  const date = new Date(y, m - 1, d + days); // 本地时间，不受时区影响
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ==================== 工具函数 ====================

/**
 * 获取今日 YYYY-MM-DD（本地时间）
 * CRITICAL FIX: 使用本地时间，不用 toISOString()（后者是 UTC，可能差一天）
 */
export function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 生成 session ID（同一次做题为一个 session） */
let _sessionId = null;
export function getSessionId() {
  if (!_sessionId) {
    _sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }
  return _sessionId;
}

export function resetSessionId() {
  _sessionId = null;
}

// ==================== 数据导出/导入 ====================

/**
 * 导出全部数据为 JSON（供备份/迁移）
 */
export async function exportAllData() {
  const db = getDB();
  const [words, progresses, logs, batches, tasks] = await Promise.all([
    withTransaction(db, 'words',          'readonly', ({ words })          => getAll(words)),
    withTransaction(db, 'word_progress',  'readonly', ({ word_progress })  => getAll(word_progress)),
    withTransaction(db, 'review_logs',    'readonly', ({ review_logs })    => getAll(review_logs)),
    withTransaction(db, 'weekly_batches', 'readonly', ({ weekly_batches }) => getAll(weekly_batches)),
    withTransaction(db, 'daily_tasks',    'readonly', ({ daily_tasks })    => getAll(daily_tasks)),
  ]);

  return {
    version:      DB_VERSION,
    exported_at:  new Date().toISOString(),
    words,
    word_progress: progresses,
    review_logs:  logs,
    weekly_batches: batches,
    daily_tasks:  tasks,
  };
}

/**
 * 从 JSON 备份恢复（默认覆盖：清空所有表后重写）
 *
 * 安全约束：
 *   - version 必须 ≤ 当前 DB_VERSION（高版本备份不允许导入）
 *   - 必须包含 5 张表（words / word_progress / review_logs / weekly_batches / daily_tasks）
 *   - 一个事务内完成清空 + 写入，失败自动回滚
 *
 * @param {object} data exportAllData 的输出
 * @returns {Promise<{ counts: Record<string, number> }>}
 */
export async function importAllData(data) {
  if (!data || typeof data !== 'object') throw new Error('备份文件格式错误');
  if (typeof data.version !== 'number' || data.version > DB_VERSION) {
    throw new Error(`备份版本不兼容（备份 v${data.version}, 当前 v${DB_VERSION}）`);
  }
  const required = ['words', 'word_progress', 'review_logs', 'weekly_batches', 'daily_tasks'];
  for (const name of required) {
    if (!Array.isArray(data[name])) throw new Error(`备份缺少表：${name}`);
  }

  const db = getDB();
  return withTransaction(db, required, 'readwrite', async (stores) => {
    const counts = {};
    for (const name of required) {
      await promisifyRequest(stores[name].clear());
      for (const row of data[name]) {
        await promisifyRequest(stores[name].put(row));
      }
      counts[name] = data[name].length;
    }
    return { counts };
  });
}
