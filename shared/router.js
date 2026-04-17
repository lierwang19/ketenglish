/**
 * shared/router.js — 轻量哈希路由
 *
 * 用法：
 *   import { createRouter } from '../../shared/router.js';
 *
 *   const router = createRouter({
 *     '/':        () => showPage('home'),
 *     '/review':  () => showPage('review'),
 *     '/stats':   () => showPage('stats'),
 *   });
 *
 *   router.start();           // 监听 hashchange，立即触发当前路由
 *   router.go('/review');     // 编程式跳转
 *   router.replace('/stats'); // 替换当前历史记录（不产生回退条目）
 *   router.current();         // 返回当前路径字符串，如 '/review'
 */

'use strict';

/**
 * @param {Record<string, Function>} routes  - { '/path': handlerFn }
 * @param {string} [fallback='/']            - 未匹配时的默认路由
 * @returns {{ start, go, replace, current, destroy }}
 */
export function createRouter(routes, fallback = '/') {
  let _onBeforeLeave = null; // 可注册一个离开前回调，返回 false 则阻止跳转

  function _getPath() {
    const hash = location.hash;
    // 支持 #/path?query 格式，只取路径部分
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const path = raw.split('?')[0] || '/';
    return path.startsWith('/') ? path : '/' + path;
  }

  function _dispatch(path) {
    const handler = routes[path] ?? routes[fallback];
    if (handler) {
      handler(path);
    } else {
      console.warn(`[Router] 未找到路由: ${path}，跳转到 fallback: ${fallback}`);
      go(fallback);
    }
  }

  function _handleHashChange() {
    const path = _getPath();
    if (_onBeforeLeave) {
      const result = _onBeforeLeave(path);
      if (result === false) {
        // 回退 hash 变更（无感知）
        history.go(-1);
        return;
      }
    }
    _dispatch(path);
  }

  function start() {
    window.addEventListener('hashchange', _handleHashChange);
    // 立即触发当前路由（页面首次加载）
    _dispatch(_getPath());
    return router;
  }

  function go(path) {
    location.hash = path.startsWith('/') ? path : '/' + path;
  }

  function replace(path) {
    const url = location.href.split('#')[0] + '#' + (path.startsWith('/') ? path : '/' + path);
    history.replaceState(null, '', url);
    _dispatch(path.startsWith('/') ? path : '/' + path);
  }

  function current() {
    return _getPath();
  }

  /**
   * 注册离开前回调
   * @param {Function|null} fn  - (nextPath) => boolean | void，返回 false 阻止跳转
   */
  function beforeLeave(fn) {
    _onBeforeLeave = fn;
  }

  function destroy() {
    window.removeEventListener('hashchange', _handleHashChange);
    _onBeforeLeave = null;
  }

  const router = { start, go, replace, current, beforeLeave, destroy };
  return router;
}
