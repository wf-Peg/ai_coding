/**
 * workspace-join.js - 通用「加入工作台」选择器
 *
 * 供内容详情/编辑器文件树/观测页等跨页面场景调用，让任意内容引用一键加入指定工作台。
 * 依赖后端既有接口：
 *   GET  /api/workspace/list                        拉取工作台列表
 *   POST /api/workspace/{workspaceId}/members       手动加入成员（source=manual）
 *
 * 使用：window.openWorkspaceJoinPicker({ contentId: 'clip:123', title: 'xxx' })
 */
(function () {
  'use strict';

  var API_BASE = 'http://127.0.0.1:8081/api';

  var pickerRoot = null;
  var panelRoot = null;
  var listEl = null;
  var currentReq = null;

  function request(url, options) {
    return fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
  }

  function toast(message, isError) {
    var el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:99999;' +
      'background:' + (isError ? '#d33' : 'var(--obs-accent, #1a73e8)') + ';color:#fff;' +
      'padding:10px 18px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
      'opacity:0;transition:opacity .22s ease;pointer-events:none;';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 240); }, 2200);
  }

  function closePicker() {
    if (pickerRoot) {
      pickerRoot.remove();
      pickerRoot = null;
      panelRoot = null;
      listEl = null;
    }
  }

  /** 展示工作台选择弹窗；contentId 为 ContentRef 引用（如 clip:123 / knowledge:1）。 */
  window.openWorkspaceJoinPicker = function (opts) {
    var contentId = opts && opts.contentId;
    var title = (opts && opts.title) || '该内容';
    if (!contentId) { toast('缺少内容引用，无法加入工作台', true); return; }
    closePicker();
    if (currentReq) { currentReq.canceled = true; }

    pickerRoot = document.createElement('div');
    pickerRoot.className = 'wjoin-mask';
    pickerRoot.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.35);backdrop-filter:blur(2px);';
    pickerRoot.addEventListener('click', function (e) { if (e.target === pickerRoot) closePicker(); });

    panelRoot = document.createElement('div');
    panelRoot.className = 'wjoin-panel';
    panelRoot.style.cssText = 'width:380px;max-width:86vw;max-height:72vh;display:flex;flex-direction:column;border-radius:12px;' +
      'background:var(--app-bg, #fff);color:var(--app-text, #1f2328);box-shadow:0 12px 44px rgba(0,0,0,.3);overflow:hidden;';
    panelRoot.innerHTML =
      '<div style="padding:16px 18px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--app-border, #e6e6e6);">' +
      '<div style="font-size:15px;font-weight:600;">加入工作台</div>' +
      '<button type="button" class="wjoin-close" style="border:none;background:transparent;cursor:pointer;font-size:18px;line-height:1;color:var(--app-text-secondary, #888);">✕</button>' +
      '</div>' +
      '<div class="wjoin-hint" style="padding:10px 18px;font-size:12px;color:var(--app-text-secondary, #888);word-break:break-all;">目标内容：' + escapeHtml(title) + '</div>' +
      '<div class="wjoin-list" style="flex:1;overflow-y:auto;padding:8px 12px;min-height:120px;">加载中…</div>' +
      '<div style="padding:12px 18px;border-top:1px solid var(--app-border, #e6e6e6);font-size:12px;color:var(--app-text-secondary, #888);">加入为永久成员（source=manual），不受规则筛选影响；从工作台内容列表可移除。</div>';

    pickerRoot.appendChild(panelRoot);
    document.body.appendChild(pickerRoot);
    panelRoot.querySelector('.wjoin-close').addEventListener('click', closePicker);

    listEl = panelRoot.querySelector('.wjoin-list');
    currentReq = {};
    var req = currentReq;

    request(API_BASE + '/workspace/list').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (workspaces) {
      if (req.canceled) return;
      var actives = (Array.isArray(workspaces) ? workspaces : []).filter(function (w) {
        return !w.status || w.status === 'active';
      });
      if (actives.length === 0) {
        listEl.innerHTML = '<div style="padding:28px 12px;text-align:center;color:var(--app-text-secondary, #888);font-size:13px;">暂无工作台，请先到工作台页面新建</div>';
        return;
      }
      listEl.innerHTML = actives.map(function (w) {
        var color = w.color || 'var(--obs-accent, #1a73e8)';
        return '<button type="button" class="wjoin-item" data-wsid="' + escapeHtml(w.id) + '" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;margin:4px 0;border:1px solid var(--app-border, #e6e6e6);border-radius:10px;background:var(--app-panel, #fafafa);cursor:pointer;text-align:left;font-size:14px;color:var(--app-text, #1f2328);">' +
          '<span style="width:10px;height:10px;border-radius:3px;background:' + color + ';flex:none;"></span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(w.name) + '</span>' +
          '<span style="font-size:11px;color:var(--app-text-secondary, #888);">' + (w.type === 'project' ? '项目' : w.type === 'learning' ? '学习' : '普通') + '</span>' +
          '</button>';
      }).join('');
      listEl.querySelectorAll('.wjoin-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var wsId = btn.getAttribute('data-wsid');
          btn.disabled = true;
          btn.style.opacity = '.6';
          btn.style.cursor = 'wait';
          request(API_BASE + '/workspace/' + encodeURIComponent(wsId) + '/members', {
            method: 'POST',
            body: JSON.stringify({ contentId: contentId })
          }).then(function (r) {
            if (!r.ok) { return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); }); }
            toast('已加入「' + (btn.querySelector('span:nth-child(2)') ? btn.querySelector('span:nth-child(2)').textContent : wsId) + '」');
            closePicker();
          }).catch(function (err) {
            toast('加入失败：' + (err && err.message ? err.message : '未知错误'), true);
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
          });
        });
      });
    }).catch(function (err) {
      if (req.canceled) return;
      listEl.innerHTML = '<div style="padding:28px 12px;text-align:center;color:#d33;font-size:13px;">加载工作台失败：' + escapeHtml((err && err.message) || '后端不可用') + '</div>';
    });
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();