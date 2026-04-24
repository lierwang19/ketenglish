/**
 * vocab-review/js/textbook-importer.js
 *
 * 教材库导入：
 * - loadCatalog()  → 读 data/textbooks/index.json，列出已内置的教材
 * - loadTextbook() → 读单个教材的完整 JSON（含每个 Day 的基础/拓展词）
 * - importDay()    → 把指定 Day 的词写入指定周次（沿用 db.addWords 的去重）
 *
 * Schema 见 data/textbooks/index.json 与 ket-core-day.json。
 * license 字段为未来付费教材包预留（'free' | 'paid'），目前只有 free 路径。
 */

'use strict';

import { addWords } from './db.js';

const BASE_URL = new URL('../data/textbooks/', import.meta.url);
const catalogCache = { data: null };
const textbookCache = new Map();

export async function loadCatalog() {
  if (catalogCache.data) return catalogCache.data;
  const res = await fetch(new URL('index.json', BASE_URL), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`教材目录加载失败：HTTP ${res.status}`);
  const data = await res.json();
  catalogCache.data = data;
  return data;
}

export async function loadTextbook(textbookId) {
  if (textbookCache.has(textbookId)) return textbookCache.get(textbookId);
  const catalog = await loadCatalog();
  const meta = catalog.textbooks?.find(t => t.id === textbookId);
  if (!meta) throw new Error(`未找到教材：${textbookId}`);
  const res = await fetch(new URL(meta.file, BASE_URL), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`教材内容加载失败：HTTP ${res.status}`);
  const data = await res.json();
  textbookCache.set(textbookId, data);
  return data;
}

export async function importDay({ textbookId, day, weekId }) {
  if (!weekId) throw new Error('请先选择目标周次');
  const book = await loadTextbook(textbookId);
  const dayEntry = book.days?.find(d => d.day === Number(day));
  if (!dayEntry) throw new Error(`教材 ${textbookId} 没有 Day ${day}`);

  const wordList = [
    ...(dayEntry.basic || []).map(w => ({
      english: w.en,
      chinese: w.cn,
      part_of_speech: w.pos || '',
      word_type: 'spelling',
      week_id: weekId,
    })),
    ...(dayEntry.extended || []).map(w => ({
      english: w.en,
      chinese: w.cn,
      part_of_speech: w.pos || '',
      word_type: 'recognition',
      week_id: weekId,
    })),
  ];

  const { inserted, skipped } = await addWords(wordList);
  return {
    inserted: inserted.length,
    skipped: skipped.length,
    basicTotal: (dayEntry.basic || []).length,
    extendedTotal: (dayEntry.extended || []).length,
    theme: dayEntry.theme || '',
  };
}

export function summarizeDay(dayEntry) {
  return {
    day: dayEntry.day,
    theme: dayEntry.theme || '',
    basicCount: (dayEntry.basic || []).length,
    extendedCount: (dayEntry.extended || []).length,
    basicSample: (dayEntry.basic || []).slice(0, 3).map(w => w.en),
    extendedSample: (dayEntry.extended || []).slice(0, 3).map(w => w.en),
  };
}
