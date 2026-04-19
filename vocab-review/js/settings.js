'use strict';

export const DEFAULT_SETTINGS = {
  basicDailyCount: 6,
  extendedDailyCount: 15,
  enableLowFrequencyCheck: true,
  enableEnterpriseWechat: false,
  reminderTime: '07:30',
  basicIntervals: [1, 3, 6, 10, 17, 30],
  extendedIntervals: [1, 4, 8, 15, 30],
};

const STORAGE_KEY = 'ket-vocab-settings';

export function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      basicIntervals: normalizeIntervalArray(parsed?.basicIntervals, DEFAULT_SETTINGS.basicIntervals),
      extendedIntervals: normalizeIntervalArray(parsed?.extendedIntervals, DEFAULT_SETTINGS.extendedIntervals),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const current = loadSettings();
  const next = {
    ...current,
    ...patch,
  };
  next.basicIntervals = normalizeIntervalArray(next.basicIntervals, DEFAULT_SETTINGS.basicIntervals);
  next.extendedIntervals = normalizeIntervalArray(next.extendedIntervals, DEFAULT_SETTINGS.extendedIntervals);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function normalizeIntervalArray(value, fallback) {
  if (!Array.isArray(value) || !value.length) return [...fallback];
  return value
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item >= 0)
    .slice(0, 8);
}
