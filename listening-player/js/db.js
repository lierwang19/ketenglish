/**
 * listening-player/js/db.js — 系统B 数据层
 *
 * Schema（6张表）：
 *   listening_sets     — 套题主表
 *   audio_assets       — 音频资源（Blob 存 IDB，iOS < 50MB）
 *   transcripts        — 原文
 *   segments           — 句段（核心）
 *   segment_logs       — 训练日志
 *   difficult_segments — 错句本
 *
 * 版本历史：
 *   v1 — 初始 Schema
 */

'use strict';

import { openDatabase, withTransaction, promisifyRequest, getAll, cursorGetAll } from '../../shared/db.js';

const DB_NAME    = 'ket-listen';
const DB_VERSION = 1;

let _db = null;

// ==================== Schema ====================

function onUpgrade(db /*, oldVersion, newVersion, tx */) {
  // listening_sets — 套题主表
  const sets = db.createObjectStore('listening_sets', { keyPath: 'id', autoIncrement: true });
  sets.createIndex('created_at', 'created_at', { unique: false });

  // audio_assets — 音频资源
  const audio = db.createObjectStore('audio_assets', { keyPath: 'id', autoIncrement: true });
  audio.createIndex('set_id',     'set_id',     { unique: false });
  audio.createIndex('part_no',    'part_no',    { unique: false });

  // transcripts — 原文（按套题+Part存储）
  const trans = db.createObjectStore('transcripts', { keyPath: 'id', autoIncrement: true });
  trans.createIndex('set_id',      'set_id',      { unique: false });
  trans.createIndex('part_no',     'part_no',     { unique: false });
  trans.createIndex('question_no', 'question_no', { unique: false });

  // segments — 句段（核心数据结构）
  const segs = db.createObjectStore('segments', { keyPath: 'id', autoIncrement: true });
  segs.createIndex('set_id',      'set_id',      { unique: false });
  segs.createIndex('audio_id',    'audio_id',    { unique: false });
  segs.createIndex('part_no',     'part_no',     { unique: false });
  segs.createIndex('question_no', 'question_no', { unique: false });
  segs.createIndex('segment_no',  'segment_no',  { unique: false });
  // 状态: 'auto'|'manual'（人工校正后变为 manual）
  segs.createIndex('status',      'status',      { unique: false });

  // segment_logs — 训练日志
  const logs = db.createObjectStore('segment_logs', { keyPath: 'id', autoIncrement: true });
  logs.createIndex('segment_id',  'segment_id',  { unique: false });
  logs.createIndex('train_date',  'train_date',  { unique: false });
  logs.createIndex('set_id',      'set_id',      { unique: false });

  // difficult_segments — 错句本
  const diff = db.createObjectStore('difficult_segments', { keyPath: 'id', autoIncrement: true });
  diff.createIndex('segment_id',  'segment_id',  { unique: true });  // 一个句段只有一条记录
  diff.createIndex('priority',    'priority',    { unique: false }); // 'high'|'medium'|'low'
  diff.createIndex('resolved',    'resolved',    { unique: false }); // 0|1
  diff.createIndex('set_id',      'set_id',      { unique: false });
}

// ==================== 初始化 ====================

export async function initDB() {
  if (_db) return _db;
  _db = await openDatabase(DB_NAME, DB_VERSION, onUpgrade);
  return _db;
}

export function getDB() {
  if (!_db) throw new Error('[ListenDB] 数据库未初始化');
  return _db;
}

// ==================== listening_sets ====================

/**
 * 创建套题
 */
export async function createSet(data) {
  const db  = getDB();
  const now = new Date().toISOString();
  return withTransaction(db, 'listening_sets', 'readwrite', ({ listening_sets }) =>
    promisifyRequest(
      listening_sets.add({
        title:      data.title || '未命名套题',
        source:     data.source || '',
        exam_type:  data.exam_type || 'KET',
        remark:     data.remark || '',
        part_count: 0,
        seg_count:  0,
        created_at: now,
        updated_at: now,
      })
    )
  );
}

export async function getAllSets() {
  const db = getDB();
  return withTransaction(db, 'listening_sets', 'readonly', ({ listening_sets }) =>
    getAll(listening_sets)
  );
}

export async function getSet(id) {
  const db = getDB();
  return withTransaction(db, 'listening_sets', 'readonly', ({ listening_sets }) =>
    promisifyRequest(listening_sets.get(id))
  );
}

export async function updateSet(id, patch) {
  const db = getDB();
  return withTransaction(db, 'listening_sets', 'readwrite', async ({ listening_sets }) => {
    const existing = await promisifyRequest(listening_sets.get(id));
    if (!existing) throw new Error('套题不存在');
    await promisifyRequest(
      listening_sets.put({ ...existing, ...patch, updated_at: new Date().toISOString() })
    );
  });
}

export async function deleteSet(id) {
  // 级联删除：audio、transcripts、segments、logs、difficult
  const db = getDB();
  return withTransaction(
    db,
    ['listening_sets', 'audio_assets', 'transcripts', 'segments', 'segment_logs', 'difficult_segments'],
    'readwrite',
    async (stores) => {
      await promisifyRequest(stores.listening_sets.delete(id));
      for (const storeName of ['audio_assets', 'transcripts', 'segments', 'segment_logs', 'difficult_segments']) {
        const records = await cursorGetAll(stores[storeName].index('set_id'), IDBKeyRange.only(id));
        for (const r of records) {
          await promisifyRequest(stores[storeName].delete(r.id));
        }
      }
    }
  );
}

// ==================== audio_assets ====================

/**
 * 保存音频文件（Blob 直存 IDB）
 * iOS Safari 配额约 50MB，超出前应提示用户
 */
export async function saveAudio(setId, file, partNo = 1) {
  const db = getDB();
  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: file.type });

  return withTransaction(db, ['audio_assets', 'listening_sets'], 'readwrite',
    async ({ audio_assets, listening_sets }) => {
      const id = await promisifyRequest(
        audio_assets.add({
          set_id:     setId,
          file_name:  file.name,
          file_type:  file.type,
          blob,                        // 音频 Blob
          duration:   0,               // 加载后由 audio.js 更新
          part_no:    partNo,
          file_size:  file.size,
          created_at: new Date().toISOString(),
        })
      );

      // 更新套题的 part_count
      const set = await promisifyRequest(listening_sets.get(setId));
      if (set) {
        await promisifyRequest(
          listening_sets.put({ ...set, updated_at: new Date().toISOString() })
        );
      }

      return id;
    }
  );
}

export async function getAudio(audioId) {
  const db = getDB();
  return withTransaction(db, 'audio_assets', 'readonly', ({ audio_assets }) =>
    promisifyRequest(audio_assets.get(audioId))
  );
}

export async function getAudiosBySet(setId) {
  const db = getDB();
  return withTransaction(db, 'audio_assets', 'readonly', ({ audio_assets }) =>
    cursorGetAll(audio_assets.index('set_id'), IDBKeyRange.only(setId))
  );
}

export async function updateAudioDuration(audioId, duration) {
  const db = getDB();
  return withTransaction(db, 'audio_assets', 'readwrite', async ({ audio_assets }) => {
    const a = await promisifyRequest(audio_assets.get(audioId));
    if (a) await promisifyRequest(audio_assets.put({ ...a, duration }));
  });
}

export async function deleteAudio(audioId) {
  const db = getDB();
  return withTransaction(db, ['audio_assets', 'segments'], 'readwrite',
    async ({ audio_assets, segments }) => {
      await promisifyRequest(audio_assets.delete(audioId));
      // 清理关联句段
      const segs = await cursorGetAll(segments.index('audio_id'), IDBKeyRange.only(audioId));
      for (const s of segs) await promisifyRequest(segments.delete(s.id));
    }
  );
}

// ==================== transcripts ====================

export async function saveTranscript(setId, partNo, questionNo, fullText) {
  const db  = getDB();
  const now = new Date().toISOString();
  return withTransaction(db, 'transcripts', 'readwrite', async ({ transcripts }) => {
    // upsert：按 set_id + part_no + question_no 唯一
    const existing = await findTranscript(setId, partNo, questionNo);
    if (existing) {
      await promisifyRequest(
        transcripts.put({ ...existing, full_text: fullText, updated_at: now })
      );
      return existing.id;
    }
    return promisifyRequest(
      transcripts.add({
        set_id:       setId,
        part_no:      partNo,
        question_no:  questionNo,
        full_text:    fullText,
        language_type: 'en',
        created_at:   now,
        updated_at:   now,
      })
    );
  });
}

async function findTranscript(setId, partNo, questionNo) {
  const db = getDB();
  const all = await withTransaction(db, 'transcripts', 'readonly', ({ transcripts }) =>
    cursorGetAll(transcripts.index('set_id'), IDBKeyRange.only(setId))
  );
  return all.find(t => t.part_no === partNo && t.question_no === questionNo) || null;
}

export async function getTranscriptsBySet(setId) {
  const db = getDB();
  return withTransaction(db, 'transcripts', 'readonly', ({ transcripts }) =>
    cursorGetAll(transcripts.index('set_id'), IDBKeyRange.only(setId))
  );
}

// ==================== segments ====================

/**
 * 批量保存句段（替换同一 audio_id 的所有旧句段）
 * @param {number} setId
 * @param {number} audioId
 * @param {Array}  segList  — [{ segment_no, start_time, end_time, segment_text, part_no, question_no, status }]
 */
export async function replaceSegments(setId, audioId, segList) {
  const db = getDB();
  return withTransaction(db, ['segments', 'listening_sets'], 'readwrite',
    async ({ segments, listening_sets }) => {
      // 删除旧句段
      const old = await cursorGetAll(segments.index('audio_id'), IDBKeyRange.only(audioId));
      for (const s of old) await promisifyRequest(segments.delete(s.id));

      // 写入新句段
      const now = new Date().toISOString();
      for (const seg of segList) {
        await promisifyRequest(
          segments.add({
            set_id:       setId,
            audio_id:     audioId,
            part_no:      seg.part_no    ?? 1,
            question_no:  seg.question_no ?? 1,
            segment_no:   seg.segment_no,
            start_time:   seg.start_time,  // 秒（浮点）
            end_time:     seg.end_time,    // 秒（浮点）
            segment_text: seg.segment_text || '',
            status:       seg.status || 'auto',
            created_at:   now,
            updated_at:   now,
          })
        );
      }

      // 更新套题 seg_count
      const allSegs = await cursorGetAll(segments.index('set_id'), IDBKeyRange.only(setId));
      const set = await promisifyRequest(listening_sets.get(setId));
      if (set) {
        await promisifyRequest(
          listening_sets.put({ ...set, seg_count: allSegs.length, updated_at: now })
        );
      }

      return segList.length;
    }
  );
}

export async function getSegmentsByAudio(audioId) {
  const db = getDB();
  const segs = await withTransaction(db, 'segments', 'readonly', ({ segments }) =>
    cursorGetAll(segments.index('audio_id'), IDBKeyRange.only(audioId))
  );
  return segs.sort((a, b) => a.segment_no - b.segment_no);
}

export async function getSegmentsBySet(setId) {
  const db = getDB();
  const segs = await withTransaction(db, 'segments', 'readonly', ({ segments }) =>
    cursorGetAll(segments.index('set_id'), IDBKeyRange.only(setId))
  );
  return segs.sort((a, b) => a.segment_no - b.segment_no);
}

export async function updateSegment(id, patch) {
  const db = getDB();
  return withTransaction(db, 'segments', 'readwrite', async ({ segments }) => {
    const s = await promisifyRequest(segments.get(id));
    if (!s) throw new Error('句段不存在');
    await promisifyRequest(
      segments.put({ ...s, ...patch, status: 'manual', updated_at: new Date().toISOString() })
    );
  });
}

/**
 * 拆分句段：将一个句段分成两个（在 splitTime 处断开）
 * @param {number} segId
 * @param {number} splitTime  秒
 * @returns {Promise<[number, number]>}  新句段的两个 id
 */
export async function splitSegment(segId, splitTime) {
  const db = getDB();
  return withTransaction(db, 'segments', 'readwrite', async ({ segments }) => {
    const s = await promisifyRequest(segments.get(segId));
    if (!s) throw new Error('句段不存在');
    if (splitTime <= s.start_time || splitTime >= s.end_time) {
      throw new Error('分割点必须在句段起止时间之间');
    }

    const now = new Date().toISOString();
    // 修改原句段为前半段
    await promisifyRequest(
      segments.put({ ...s, end_time: splitTime, status: 'manual', updated_at: now })
    );

    // 插入后半段（segment_no = 原 + 0.5，后续重新排序）
    const newId = await promisifyRequest(
      segments.add({
        ...s,
        id:           undefined,
        start_time:   splitTime,
        end_time:     s.end_time,
        segment_no:   s.segment_no + 0.5,
        segment_text: '',
        status:       'manual',
        created_at:   now,
        updated_at:   now,
      })
    );

    // 重新排序：按 start_time 重新分配 segment_no
    await reorderSegmentsByAudio(segments, s.audio_id);

    return [segId, newId];
  });
}

/**
 * 合并相邻句段
 */
export async function mergeSegments(segId1, segId2) {
  const db = getDB();
  return withTransaction(db, 'segments', 'readwrite', async ({ segments }) => {
    const s1 = await promisifyRequest(segments.get(segId1));
    const s2 = await promisifyRequest(segments.get(segId2));
    if (!s1 || !s2) throw new Error('句段不存在');

    const now = new Date().toISOString();
    // 取较早的起始和较晚的结束
    const merged = {
      ...s1,
      start_time:   Math.min(s1.start_time, s2.start_time),
      end_time:     Math.max(s1.end_time,   s2.end_time),
      segment_text: [s1.segment_text, s2.segment_text].filter(Boolean).join(' '),
      status:       'manual',
      updated_at:   now,
    };

    await promisifyRequest(segments.put(merged));
    await promisifyRequest(segments.delete(segId2));
    await reorderSegmentsByAudio(segments, s1.audio_id);
  });
}

/** 按 start_time 重新分配 segment_no（从 1 开始） */
async function reorderSegmentsByAudio(segStore, audioId) {
  const all = await cursorGetAll(segStore.index('audio_id'), IDBKeyRange.only(audioId));
  const sorted = all.sort((a, b) => a.start_time - b.start_time);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].segment_no !== i + 1) {
      await promisifyRequest(segStore.put({ ...sorted[i], segment_no: i + 1 }));
    }
  }
}

// ==================== segment_logs ====================

/**
 * 记录一次播放/训练
 */
export async function logSegmentPlay(segmentId, setId, opts = {}) {
  const db  = getDB();
  const now = new Date();
  return withTransaction(db, 'segment_logs', 'readwrite', ({ segment_logs }) =>
    promisifyRequest(
      segment_logs.add({
        segment_id:  segmentId,
        set_id:      setId,
        train_date:  formatDate(now),
        play_count:  opts.play_count  ?? 1,
        speed:       opts.speed       ?? 1.0,
        loop_count:  opts.loop_count  ?? 1,
        mode:        opts.mode        ?? 'precise', // 'precise'|'exam'|'review'
        is_difficult: opts.is_difficult ?? false,
        created_at:  now.toISOString(),
      })
    )
  );
}

export async function getSegmentLogs(segmentId) {
  const db = getDB();
  return withTransaction(db, 'segment_logs', 'readonly', ({ segment_logs }) =>
    cursorGetAll(segment_logs.index('segment_id'), IDBKeyRange.only(segmentId))
  );
}

export async function getSetStats(setId) {
  const db = getDB();
  const logs = await withTransaction(db, 'segment_logs', 'readonly', ({ segment_logs }) =>
    cursorGetAll(segment_logs.index('set_id'), IDBKeyRange.only(setId))
  );

  const totalPlays = logs.reduce((s, l) => s + (l.play_count || 0), 0);
  const bySegment  = {};
  logs.forEach(l => {
    bySegment[l.segment_id] = (bySegment[l.segment_id] || 0) + (l.play_count || 0);
  });

  return { totalPlays, bySegment };
}

// ==================== difficult_segments ====================

/**
 * 将句段加入错句本（幂等：已存在则更新优先级）
 */
export async function markDifficult(segmentId, setId, priority = 'medium', markSource = 'manual') {
  const db  = getDB();
  const now = new Date().toISOString();

  return withTransaction(db, 'difficult_segments', 'readwrite', async ({ difficult_segments }) => {
    // 尝试查找已有记录
    const existing = await promisifyRequest(
      difficult_segments.index('segment_id').get(segmentId)
    );

    if (existing) {
      await promisifyRequest(
        difficult_segments.put({
          ...existing,
          priority,
          resolved:   0,
          resolved_at: null,
          updated_at: now,
        })
      );
      return existing.id;
    }

    return promisifyRequest(
      difficult_segments.add({
        segment_id:  segmentId,
        set_id:      setId,
        mark_source: markSource, // 'manual'|'auto'
        priority,                // 'high'|'medium'|'low'
        resolved:    0,          // 0|1
        resolved_at: null,
        marked_at:   now,
        updated_at:  now,
      })
    );
  });
}

/**
 * 标记为已解决
 */
export async function resolveDifficult(segmentId) {
  const db  = getDB();
  const now = new Date().toISOString();
  return withTransaction(db, 'difficult_segments', 'readwrite', async ({ difficult_segments }) => {
    const existing = await promisifyRequest(
      difficult_segments.index('segment_id').get(segmentId)
    );
    if (existing) {
      await promisifyRequest(
        difficult_segments.put({ ...existing, resolved: 1, resolved_at: now, updated_at: now })
      );
    }
  });
}

/**
 * 移出错句本
 */
export async function removeDifficult(segmentId) {
  const db = getDB();
  return withTransaction(db, 'difficult_segments', 'readwrite', async ({ difficult_segments }) => {
    const existing = await promisifyRequest(
      difficult_segments.index('segment_id').get(segmentId)
    );
    if (existing) {
      await promisifyRequest(difficult_segments.delete(existing.id));
    }
  });
}

export async function getDifficultSegments(resolvedFilter = null) {
  const db  = getDB();
  const all = await withTransaction(db, 'difficult_segments', 'readonly', ({ difficult_segments }) =>
    getAll(difficult_segments)
  );

  const filtered = resolvedFilter === null
    ? all
    : all.filter(d => d.resolved === (resolvedFilter ? 1 : 0));

  // 按优先级排序：high > medium > low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return filtered.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
}

/**
 * 获取某套题的错句集合（含句段详情）
 */
export async function getDifficultsBySet(setId) {
  const db = getDB();
  const difficults = await withTransaction(db, 'difficult_segments', 'readonly', ({ difficult_segments }) =>
    cursorGetAll(difficult_segments.index('set_id'), IDBKeyRange.only(setId))
  );

  const segIds = difficults.map(d => d.segment_id);
  const segments = await withTransaction(db, 'segments', 'readonly', async ({ segments: store }) => {
    const result = [];
    for (const id of segIds) {
      const s = await promisifyRequest(store.get(id));
      if (s) result.push(s);
    }
    return result;
  });

  const segMap = new Map(segments.map(s => [s.id, s]));
  return difficults.map(d => ({ ...d, segment: segMap.get(d.segment_id) || null }));
}

/**
 * 全局错句本（跨套题）
 */
export async function getAllDifficults() {
  const db = getDB();
  const difficults = await getDifficultSegments(false); // 未解决的

  const segIds = [...new Set(difficults.map(d => d.segment_id))];
  const segments = await withTransaction(db, 'segments', 'readonly', async ({ segments: store }) => {
    const result = [];
    for (const id of segIds) {
      const s = await promisifyRequest(store.get(id));
      if (s) result.push(s);
    }
    return result;
  });

  const setIds = [...new Set(segments.map(s => s.set_id))];
  const sets = await withTransaction(db, 'listening_sets', 'readonly', async ({ listening_sets }) => {
    const result = [];
    for (const id of setIds) {
      const s = await promisifyRequest(listening_sets.get(id));
      if (s) result.push(s);
    }
    return result;
  });

  const segMap = new Map(segments.map(s => [s.id, s]));
  const setMap = new Map(sets.map(s => [s.id, s]));

  return difficults.map(d => ({
    ...d,
    segment: segMap.get(d.segment_id) || null,
    set:     segMap.get(d.segment_id) ? setMap.get(segMap.get(d.segment_id).set_id) : null,
  }));
}

// ==================== 全局统计 ====================

export async function getOverallStats() {
  const db = getDB();
  const [sets, difficults, logs] = await Promise.all([
    withTransaction(db, 'listening_sets',     'readonly', ({ listening_sets })     => getAll(listening_sets)),
    withTransaction(db, 'difficult_segments', 'readonly', ({ difficult_segments }) => getAll(difficult_segments)),
    withTransaction(db, 'segment_logs',       'readonly', ({ segment_logs })       => getAll(segment_logs)),
  ]);

  const totalPlays  = logs.reduce((s, l) => s + (l.play_count || 0), 0);
  const unresolvedDifficults = difficults.filter(d => !d.resolved).length;
  const resolvedDifficults   = difficults.filter(d =>  d.resolved).length;

  return {
    setCount:            sets.length,
    totalPlays,
    unresolvedDifficults,
    resolvedDifficults,
    totalDifficults:     difficults.length,
  };
}

// ==================== 数据导出 ====================

export async function exportSetData(setId) {
  const db = getDB();
  const [set, audios, transcripts, segments, logs, difficults] = await Promise.all([
    getSet(setId),
    getAudiosBySet(setId),
    getTranscriptsBySet(setId),
    getSegmentsBySet(setId),
    withTransaction(db, 'segment_logs', 'readonly', ({ segment_logs }) =>
      cursorGetAll(segment_logs.index('set_id'), IDBKeyRange.only(setId))
    ),
    getDifficultsBySet(setId),
  ]);

  // 导出时不包含 Blob（太大），只包含元数据
  const audiosWithoutBlob = audios.map(({ blob: _, ...rest }) => rest);

  return {
    version:     1,
    exported_at: new Date().toISOString(),
    set,
    audios:      audiosWithoutBlob,
    transcripts,
    segments,
    logs,
    difficults,
  };
}

// ==================== 工具 ====================

function formatDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
