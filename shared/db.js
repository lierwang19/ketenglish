/**
 * shared/db.js — IndexedDB 底层工具
 *
 * 只提供通用的 openDB + 事务工具，不含业务 Schema。
 * 业务 Schema 在各子系统的 js/db.js 中定义。
 */

'use strict';

/**
 * 打开 IndexedDB 数据库
 * @param {string} name         - 数据库名
 * @param {number} version      - 版本号
 * @param {Function} onUpgrade  - (db, oldVersion, newVersion, tx) => void
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase(name, version, onUpgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);

    req.onupgradeneeded = (event) => {
      try {
        onUpgrade(event.target.result, event.oldVersion, event.newVersion, event.target.transaction);
      } catch (err) {
        // 升级失败时中止事务，防止部分迁移损坏数据
        event.target.transaction.abort();
        reject(err);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
    req.onblocked = () => {
      console.warn('[KET-DB] 数据库升级被阻塞，请关闭其他标签页后刷新');
    };
  });
}

/**
 * 在指定 store 上执行事务操作
 * @param {IDBDatabase} db
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {Function} fn  - (stores) => Promise<T>，stores 是各 store 的 Map
 * @returns {Promise<T>}
 */
export function withTransaction(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = db.transaction(names, mode);
    const stores = {};
    names.forEach(n => { stores[n] = tx.objectStore(n); });

    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('事务已中止'));

    Promise.resolve()
      .then(() => fn(stores))
      .then(r => { result = r; })
      .catch(err => {
        tx.abort();
        reject(err);
      });
  });
}

/**
 * IDBRequest → Promise
 */
export function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * IDBObjectStore 的 getAll 封装
 */
export function getAll(store) {
  return promisifyRequest(store.getAll());
}

/**
 * 游标遍历，返回所有匹配记录
 * @param {IDBObjectStore|IDBIndex} source
 * @param {IDBKeyRange|null} range
 * @returns {Promise<Array>}
 */
export function cursorGetAll(source, range = null) {
  return new Promise((resolve, reject) => {
    const results = [];
    const req = source.openCursor(range);
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 检测 IndexedDB 是否可用（隐私模式检测）
 * @returns {Promise<boolean>}
 */
export async function checkIndexedDBAvailable() {
  try {
    const testDb = await openDatabase('_ket_test_', 1, (db) => {
      db.createObjectStore('test');
    });
    testDb.close();
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('_ket_test_');
      req.onsuccess = resolve;
      req.onerror = reject;
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取存储使用情况（字节）
 * @returns {Promise<{usage: number, quota: number, percent: number}>}
 */
export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) {
    return { usage: 0, quota: 0, percent: 0 };
  }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const percent = quota > 0 ? Math.round((usage / quota) * 100) : 0;
  return { usage, quota, percent };
}

/**
 * 将字节数格式化为人类可读字符串
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
