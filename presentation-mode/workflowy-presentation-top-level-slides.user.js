// ==UserScript==
// @name         WorkFlowy Presentation — top-level bullets only (real nodes)
// @namespace    https://workflowy.com/
// @version      2.0.0
// @description  In WorkFlowy Presentation Mode, Left/Right (and a custom bottom bar) move only between the top-level bullets — the slides — and never descend into sub-bullets. Each slide shows all of its direct bullets at once, using WorkFlowy's own real, editable nodes: no copies, no restyling. Deeper bullets appear as collapse dots (open one live with Cmd+Down if you want to drill in).
// @author       —
// @match        https://workflowy.com/*
// @match        https://*.workflowy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var active = false;
  var presRoot = null;   // the node being presented; its children are the slides
  var pos = 0;           // 0 = title slide (presRoot); 1..n = each top-level child
  var userEditing = false; // true once you click into / type in a bullet on this slide

  function wfReady() { return typeof window.WF !== 'undefined' && WF && typeof WF.currentItem === 'function'; }

  function liveChildren(item) {
    try {
      return item.getChildren().filter(function (it) {
        try { return !it.isCompleted(); } catch (e) { return true; }
      });
    } catch (e) { return []; }
  }
  function slides() { return presRoot ? liveChildren(presRoot) : []; }

  function go(next) {
    userEditing = false; // arriving on a new slide is a viewing state, not editing
    var s = slides();
    pos = Math.max(0, Math.min(s.length, next));
    if (pos === 0) {
      // Title slide: WorkFlowy shows the presented node's centered title.
      document.body.classList.remove('wfp-slide');
      try { WF.zoomTo(presRoot); } catch (e) {}
    } else {
      // Zoom into the slide (a top-level bullet). WorkFlowy renders its direct
      // bullets; the reveal CSS below shows them all at once instead of one by one.
      try { WF.zoomTo(s[pos - 1]); } catch (e) {}
      document.body.classList.add('wfp-slide');
    }
    updateBar();
  }

  // ---- Custom bottom bar (replaces WorkFlowy's own forward/back arrows) ----
  function bar() {
    var b = document.getElementById('wfp-bar');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'wfp-bar';
    b.innerHTML =
      '<button type="button" class="wfp-nav" data-dir="prev" aria-label="Previous slide">‹</button>' +
      '<span class="wfp-count"></span>' +
      '<button type="button" class="wfp-nav" data-dir="next" aria-label="Next slide">›</button>';
    b.addEventListener('click', function (e) {
      var nav = e.target.closest('.wfp-nav');
      if (!nav) return;
      e.preventDefault();
      e.stopPropagation();
      go(pos + (nav.getAttribute('data-dir') === 'next' ? 1 : -1));
    });
    document.body.appendChild(b);
    return b;
  }
  function updateBar() {
    var b = document.getElementById('wfp-bar');
    if (!b) return;
    var max = slides().length;
    var prev = b.querySelector('.wfp-nav[data-dir="prev"]');
    var next = b.querySelector('.wfp-nav[data-dir="next"]');
    var count = b.querySelector('.wfp-count');
    if (prev) prev.disabled = pos <= 0;
    if (next) next.disabled = pos >= max;
    if (count) count.textContent = pos === 0 ? 'Title' : (pos + ' / ' + max);
  }

  // ---- Input interception (only the slide-stepping keys) ----
  // Left/Right move between slides. The tricky part is editing: WorkFlowy auto-focuses
  // a bullet on slide entry (and an empty slide even opens edit mode with a cursor), so
  // we must NOT treat every focused/edit state as "the user is editing". We only stand
  // down from the arrows once you actually engage a bullet — by clicking into it or by
  // typing. Until then, arrows navigate. (The bottom-bar arrows always navigate, even
  // mid-edit, so you're never stuck.)
  function editModeOpen() { return !!document.querySelector('.exit-edit-mode-button'); }
  function onPointerDown(e) {
    if (!active) return;
    if (e.target.closest && e.target.closest('.name, .content, [contenteditable="true"]')) userEditing = true;
  }
  function onKey(e) {
    if (!active) return;
    var k = e.key;
    var isNav = (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'PageDown' || k === 'PageUp');
    if (editModeOpen()) {
      if (!isNav) { userEditing = true; return; } // typing -> you're editing; let it through
      if (userEditing) return;                     // arrows while actively editing -> move cursor
      // otherwise it's just auto edit mode (e.g. an empty slide) -> navigate
    } else if (!isNav) {
      return;
    }
    if (!isNav) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    go(pos + ((k === 'ArrowRight' || k === 'PageDown') ? 1 : -1));
  }

  // ---- Styles: NO changes to bullet text, size, or color. Only: hide WorkFlowy's
  //      own nav arrows, reveal a slide's bullets at once, and style the custom bar.
  function injectStyle() {
    if (document.getElementById('wfp-style')) return;
    var css =
      '.present-navigation{display:none !important;}' +
      // Reveal every rendered bullet of the current slide at once (WorkFlowy normally
      // fades them in one at a time). Only applies while viewing a slide, not the title.
      'body.wfp-slide .root .project{opacity:1 !important;}' +

      '#wfp-bar{position:fixed;left:0;right:0;bottom:26px;z-index:500;' +
      'display:flex;align-items:center;justify-content:center;gap:16px;' +
      'pointer-events:none;font-family:inherit;}' +
      '#wfp-bar > *{pointer-events:auto;}' +
      '#wfp-bar .wfp-nav{appearance:none;border:1px solid var(--wf-border-secondary,#42484b);' +
      'background:var(--wf-background-ambient,#2a3135);color:var(--wf-text-secondary,#d9dbdb);' +
      'width:40px;height:40px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;}' +
      '#wfp-bar .wfp-nav:hover:not(:disabled){color:var(--wf-text-primary,#fff);}' +
      '#wfp-bar .wfp-nav:disabled{opacity:0.35;cursor:default;}' +
      '#wfp-bar .wfp-count{min-width:56px;text-align:center;font-size:13px;' +
      'color:var(--wf-text-tertiary,#9ea1a2);' +
      'padding:6px 12px;border-radius:10px;' +
      'background:var(--wf-background-ambient,#2a3135);' +
      'border:1px solid var(--wf-border-secondary,#42484b);' +
      'box-shadow:0 2px 20px rgba(0,0,0,0.28);}';
    var s = document.createElement('style');
    s.id = 'wfp-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- Lifecycle ----
  function activate() {
    if (active || !wfReady()) return;
    var root = WF.currentItem();
    if (!root) return;
    active = true;
    presRoot = root;
    pos = 0;
    injectStyle();
    bar();
    updateBar();
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    // pos 0 -> title slide; nothing else to show yet.
  }
  function deactivate() {
    if (!active) return;
    active = false;
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    userEditing = false;
    document.body.classList.remove('wfp-slide');
    var b = document.getElementById('wfp-bar'); if (b) b.remove();
    presRoot = null;
    pos = 0;
  }

  function inPresentation() { return !!document.querySelector('.present-overlay'); }

  var pending = null;
  function sync() {
    var here = inPresentation();
    if (here && !active) {
      if (wfReady()) activate();
      else if (!pending) pending = setTimeout(function () { pending = null; sync(); }, 100);
    } else if (!here && active) {
      deactivate();
    }
  }

  var mo = new MutationObserver(sync);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  sync();
})();
