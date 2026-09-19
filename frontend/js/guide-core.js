/**
 * guide-core.js —— 共享「上手引导」清单卡渲染器
 *
 * 自包含、零依赖、ES5，供多个宿主页面复用：
 *  - electron/config.html（首次安装窗口，file:// 加载）
 *  - frontend/settings.html（设置页重播引导）
 *
 * 特性：
 *  - 注入自带 <style>（带 data-guide-core 标记，幂等）。
 *  - 全部样式作用域在 [data-guide-core] .g-root 下，令牌自含（不依赖宿主令牌，
 *    但跟随 html[data-theme="dark"] 提供暗色覆盖），保证两处表现一致、无色漂移。
 *  - 暴露 window.CutShelterGuide.render(container, spec) 与
 *    resolveCanProceed(spec)。
 *
 * 约定：provider/AI 等字段命名与 settings.js / electron/main.js 对齐。
 */
(function () {
  'use strict';

  // 是否已注入样式（幂等）
  var STYLE_TAG_ID = 'cut-shelter-guide-core-style';

  /**
   * 把注入的样式作用域写在 [data-guide-core] .g-root 之下，
   * 并定义浅/深两套令牌，使组件无论宿主是否引入全局令牌都能自洽渲染。
   */
  function injectStyle() {
    if (document.getElementById(STYLE_TAG_ID)) return;

    var css = [
      '/* guide-core 注入样式（根节点自身带 data-guide-core，令牌自含） */',
      '[data-guide-core].g-root{',
      '  --g-bg:#f7f7f5; --g-surface:#ffffff; --g-surface-subtle:#f1f1ef;',
      '  --g-border:#e3e3df; --g-border-strong:#d2d2cd;',
      '  --g-text:#2f3437; --g-text-secondary:#6b6f76; --g-text-muted:#92969d;',
      '  --g-primary:#2383e2; --g-primary-hover:#1f76c9; --g-primary-soft:rgba(35,131,226,.10);',
      '  --g-success:#238b63; --g-success-soft:rgba(35,139,99,.10);',
      '  --g-danger:#d14343; --g-danger-soft:rgba(209,67,67,.10);',
      '  --g-warn-bg:#fff8f1; --g-warn-ink:#5b4636; --g-warn-accent:#e8871e; --g-warn-accent-soft:rgba(232,135,30,.14);',
      '}',
      'html[data-theme="dark"] [data-guide-core].g-root{',
      '  --g-bg:#1e1e1e; --g-surface:#282828; --g-surface-subtle:#323232;',
      '  --g-border:#414141; --g-border-strong:#525252;',
      '  --g-text:#dedede; --g-text-secondary:#aaa; --g-text-muted:#777;',
      '  --g-primary:#61a6ff; --g-primary-hover:#7bb5ff; --g-primary-soft:rgba(97,166,255,.14);',
      '  --g-success:#56c997; --g-success-soft:rgba(86,201,151,.14);',
      '  --g-danger:#ef7777; --g-danger-soft:rgba(239,119,119,.12);',
      '  --g-warn-bg:#2b2522; --g-warn-ink:#e8d9c9; --g-warn-accent:#ffb25e; --g-warn-accent-soft:rgba(255,178,94,.16);',
      '}',
      '[data-guide-core] *, [data-guide-core] *::before, [data-guide-core] *::after{box-sizing:border-box;margin:0;padding:0;}',
      '[data-guide-core] .g-root{background:var(--g-bg);color:var(--g-text);',
      '  font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif;',
      '  padding:20px;max-width:520px;margin:0 auto;line-height:1.5;}',
      '[data-guide-core] .g-hero{text-align:center;margin-bottom:18px;}',
      '[data-guide-core] .g-hero-title{font-size:22px;font-weight:700;letter-spacing:.01em;}',
      '[data-guide-core] .g-hero-sub{font-size:13px;color:var(--g-text-secondary);margin-top:6px;}',
      '[data-guide-core] .g-progress{display:flex;justify-content:center;gap:8px;margin:14px auto 0;width:fit-content;}',
      '[data-guide-core] .g-dot{width:8px;height:8px;border-radius:999px;background:var(--g-border-strong);}',
      '[data-guide-core] .g-dot.done{background:var(--g-success);}',
      '[data-guide-core] .g-dot.current{background:var(--g-primary);}',
      '[data-guide-core] .g-cards{display:flex;flex-direction:column;gap:12px;}',
      '[data-guide-core] .g-card{background:var(--g-surface);border:1px solid var(--g-border);',
      '  border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,.06);overflow:hidden;cursor:pointer;',
      '  transition:box-shadow .18s ease,transform .18s ease;}',
      '[data-guide-core] .g-card:hover{box-shadow:0 4px 6px rgba(15,23,42,.06);}',
      '[data-guide-core] .g-card-header{display:flex;align-items:flex-start;gap:12px;padding:16px;}',
      '[data-guide-core] .g-card-icon{font-size:24px;line-height:1;width:40px;height:40px;flex:0 0 40px;',
      '  display:flex;align-items:center;justify-content:center;border-radius:10px;',
      '  background:var(--g-surface-subtle);border:1px solid var(--g-border);}',
      '[data-guide-core] .g-card-icon.warm{background:var(--g-warn-accent-soft);border-color:transparent;',
      '  color:var(--g-warn-accent);}',
      '[data-guide-core] .g-card-body{flex:1;min-width:0;}',
      '[data-guide-core] .g-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '[data-guide-core] .g-card-label{font-size:15px;font-weight:600;}',
      '[data-guide-core] .g-badge{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;}',
      '[data-guide-core] .g-badge.required{background:var(--g-danger-soft);color:var(--g-danger);}',
      '[data-guide-core] .g-badge.opt{background:var(--g-primary-soft);color:var(--g-primary);}',
      '[data-guide-core] .g-card-desc{font-size:12.5px;color:var(--g-text-secondary);margin-top:4px;}',
      '[data-guide-core] .g-status{margin-top:10px;display:flex;align-items:center;gap:6px;',
      '  font-size:12px;font-weight:500;color:var(--g-text-muted);}',
      '[data-guide-core] .g-status-dot{width:8px;height:8px;border-radius:999px;}',
      '[data-guide-core] .g-status.danger .g-status-dot{background:var(--g-danger);}',
      '[data-guide-core] .g-status.danger{color:var(--g-danger);}',
      '[data-guide-core] .g-status.ok .g-status-dot{background:var(--g-success);}',
      '[data-guide-core] .g-status.ok{color:var(--g-success);}',
      '[data-guide-core] .g-status.muted .g-status-dot{background:var(--g-border-strong);}',
      '[data-guide-core] .g-chevron{margin-left:auto;color:var(--g-text-muted);font-size:14px;align-self:center;}',
      '[data-guide-core] .g-card-fields{display:none;border-top:1px solid var(--g-border);padding:16px;cursor:default;}',
      '[data-guide-core] .g-card.open .g-card-fields{display:block;}',
      '[data-guide-core] .g-card.open .g-chevron{transform:rotate(180deg);}',
      '[data-guide-core] .g-field{margin-bottom:14px;}',
      '[data-guide-core] .g-field:last-of-type{margin-bottom:0;}',
      '[data-guide-core] .g-label{display:block;font-size:12.5px;font-weight:600;color:var(--g-text);margin-bottom:6px;}',
      '[data-guide-core] .g-path-row{display:flex;gap:8px;}',
      '[data-guide-core] input[type="text"],',
      '[data-guide-core] input[type="number"],',
      '[data-guide-core] input[type="password"],',
      '[data-guide-core] select{width:100%;padding:9px 12px;font-size:13px;color:var(--g-text);',
      '  background:var(--g-surface);border:1px solid var(--g-border-strong);border-radius:8px;outline:none;',
      '  transition:border-color .15s,box-shadow .15s;}',
      '[data-guide-core] input:focus,[data-guide-core] select:focus{border-color:var(--g-primary);',
      '  box-shadow:0 0 0 3px var(--g-primary-soft);}',
      '[data-guide-core] .g-hint{font-size:11.5px;color:var(--g-text-muted);margin-top:6px;}',
      '[data-guide-core] .g-actions{margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;}',
      '[data-guide-core] .g-btn{border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;',
      '  cursor:pointer;transition:background .15s,opacity .15s;font-family:inherit;}',
      '[data-guide-core] .g-btn.primary{background:var(--g-primary);color:#fff;}',
      '[data-guide-core] .g-btn.primary:hover{background:var(--g-primary-hover);}',
      '[data-guide-core] .g-btn.primary:disabled{opacity:.5;cursor:not-allowed;}',
      '[data-guide-core] .g-btn.ghost{background:transparent;color:var(--g-text-secondary);border:1px solid var(--g-border-strong);}',
      '[data-guide-core] .g-btn.ghost:hover{background:var(--g-surface-subtle);}',
      '[data-guide-core] .g-btn.danger{background:transparent;color:var(--g-danger);border:1px solid var(--g-danger);}',
      '[data-guide-core] .g-btn.danger:hover{background:var(--g-danger-soft);}',
      '[data-guide-core] .g-footer{margin-top:18px;display:flex;flex-direction:column;align-items:center;gap:10px;}',
      '[data-guide-core] .g-footer-note{font-size:12px;color:var(--g-text-muted);}',
      '[data-guide-core] .g-footer-action{width:100%;}',
      '[data-guide-core] .g-footer-action .g-btn{width:100%;padding:11px;font-size:14px;border-radius:10px;}',
      '[data-guide-core] .g-empty{font-size:13px;color:var(--g-text-muted);text-align:center;padding:24px 0;}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.setAttribute('data-guide-core', '');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  /** 根据 cards 中 required 卡是否都处于 ok 态，判断主按钮是否可提交 */
  function resolveCanProceed(spec) {
    return spec.cards.every(function (c) {
      return !c.required || (c.status && c.status.tone === 'ok');
    });
  }

  function statusDotClass(tone) {
    return 'g-status ' + (tone || 'muted');
  }

  function renderHeader(spec, wrap) {
    wrap.appendChild(el('div', { class: 'g-hero' },
      '<div class="g-hero-title">' + (spec.title || '') + '</div>' +
      (spec.subtitle ? '<div class="g-hero-sub">' + spec.subtitle + '</div>' : '') +
      (spec.stepText ? '<div class="g-step">' + spec.stepText + '</div>' : '')
    ));
    if (spec.progress) {
      var prog = el('div', { class: 'g-progress' });
      spec.progress.forEach(function (p) {
        prog.appendChild(el('span', { class: 'g-dot ' + (p.state || 'pending') }));
      });
      wrap.appendChild(prog);
    }
  }

  /**
   * 渲染清单卡集合到 container。
   * spec.cards 每项字段见文件头注释。
   */
  function render(container, spec) {
    injectStyle();
    if (!container) return;

    var root = el('div', { class: 'g-root' });
    root.setAttribute('data-guide-core', '');

    renderHeader(spec, root);

    if (!spec.cards || !spec.cards.length) {
      root.appendChild(el('div', { class: 'g-empty' }, '暂无引导项'));
      container.innerHTML = '';
      container.appendChild(root);
      return;
    }

    var cardWrap = el('div', { class: 'g-cards' });
    var notify = function () {
      if (typeof spec.onDone === 'function') spec.onDone(resolveCanProceed(spec));
    };

    spec.cards.forEach(function (card) {
      var isOpen = !!card.open;
      var warm = card.icon === '🧠' || card.icon === '💡' || card.icon === '✨';

      var iconDiv = el('div', {
        class: 'g-card-icon' + (warm ? ' warm' : '')
      }, card.icon || '📂');

      var body = el('div', { class: 'g-card-body' });

      // 标题行：label + badge(required/opt)
      var top = el('div', { class: 'g-card-top' },
        '<span class="g-card-label">' + (card.label || '') + '</span>' +
        (card.required ? '<span class="g-badge required">必填</span>' : '') +
        (card.badgeOpt ? '<span class="g-badge opt">' + (card.badgeOpt === true ? '稍后可配' : card.badgeOpt) + '</span>' : '')
      );
      body.appendChild(top);

      if (card.desc) {
        body.appendChild(el('div', { class: 'g-card-desc' }, card.desc));
      }

      // 状态行
      if (card.status) {
        var st = el('div', {
          class: statusDotClass(card.status.tone)
        }, '<span class="g-status-dot"></span><span>' + (card.status.text || '') + '</span>');
        body.appendChild(st);
      }

      var header = el('div', { class: 'g-card-header' });
      header.appendChild(iconDiv);
      header.appendChild(body);
      header.appendChild(el('div', { class: 'g-chevron' }, '▾'));

      var fields = el('div', { class: 'g-card-fields' });
      if (isOpen) {
        fields.innerHTML = typeof card.fieldsHtml === 'function' ? card.fieldsHtml() : (card.fieldsHtml || '');
      }

      var cardDom = el('div', {
        class: 'g-card' + (isOpen ? ' open' : '')
      });
      cardDom.appendChild(header);
      cardDom.appendChild(fields);

      // 点击卡片展开/收起（点击内部控件时不触发）
      header.addEventListener('click', function () {
        var open = cardDom.classList.toggle('open');
        if (open) {
          fields.innerHTML = typeof card.fieldsHtml === 'function' ? card.fieldsHtml() : (card.fieldsHtml || '');
        }
        if (typeof card.onToggle === 'function') card.onToggle(open);
        notify();
      });

      // 卡片动作区（可含「跳过」等），独立于 fieldsHtml，点击不冒泡到卡片
      if (card.actions) {
        var act = el('div', { class: 'g-actions' });
        act.innerHTML = typeof card.actions === 'function' ? card.actions() : (card.actions || '');
        cardDom.appendChild(act);
      }
      cardDom.addEventListener('click', function (e) {
        if (e.target.closest('input,select,button,a,label')) return;
        header.click();
      });

      spec.cards.forEach(function (c) { if (c === card) card._dom = cardDom; });
      cardWrap.appendChild(cardDom);
    });

    root.appendChild(cardWrap);

    // 底部：说明 + 主按钮
    var foot = el('div', { class: 'g-footer' });
    if (spec.footerNote) {
      foot.appendChild(el('div', { class: 'g-footer-note' }, spec.footerNote));
    }
    if (spec.primaryAction) {
      var actWrap = el('div', { class: 'g-footer-action' });
      var btn = el('button', {
        class: 'g-btn primary',
        id: spec.primaryAction.id || 'gPrimaryAction'
      }, spec.primaryAction.label || '开始使用');
      if (typeof spec.primaryAction.onClick === 'function') {
        btn.addEventListener('click', function () { spec.primaryAction.onClick(); });
      }
      actWrap.appendChild(btn);
      spec._primaryBtn = btn;
      foot.appendChild(actWrap);
    }
    root.appendChild(foot);

    container.innerHTML = '';
    container.appendChild(root);

    // 初始同步主按钮可用性
    if (spec._primaryBtn) {
      spec._primaryBtn.disabled = !resolveCanProceed(spec);
    }
    notify();
  }

  // 暴露 API
  window.CutShelterGuide = {
    render: render,
    resolveCanProceed: resolveCanProceed
  };
})();