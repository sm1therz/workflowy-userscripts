// ==UserScript==
// @name         Workflowy Export 5 > Toggle Panel + Links + Hashtags + > + Colors
// @namespace    https://workflowy.com/
// @version      4.0
// @description  Persistent toggle panel (localStorage-backed). Hashtags: convert # to H2, remove hashtags, capitalize, dashes-to-spaces. Cleanup: remove links, remove == highlights. Notes: clean note blockquotes. Block Quotes: remove bullets, join root siblings, add line between. Code Blocks: remove bullets. Always-on: list-indentation normalization to tabs. Open sections get a faint outline. v4.0: Workflowy moved the export preview into a sandboxed cross-origin iframe, so the old "read the textarea" copy hook is dead; copy now works by intercepting navigator.clipboard.write. Native Copy stays raw; a green "Copy (mod)" button and Cmd/Ctrl+C copy transformed Markdown (Markdown tab only). The dialog opens on the Markdown tab.
// @match        https://workflowy.com/*
// @match        https://beta.workflowy.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ----------------------------------------------------------------------
  // Toggle state (localStorage-backed). Data-driven: add a switch to a
  // section's `toggles`, or a section to SECTIONS; the panel, persistence,
  // and defaults pick it up automatically.
  //   - normal toggle: { id, label, def, sepAfter? }
  //   - h2 toggle:      { id, label, def, kind:'h2', help, tagsKey, expandKey,
  //                       subKey?, subLabel?, subHelp? }
  // ----------------------------------------------------------------------
  const STORAGE_KEY = 'wfExportToggles';
  const SECTIONS = [
    {
      id: 'hashtags',
      label: 'Hashtags',
      collapsed: false,
      toggles: [
        { id: 'convertH2', label: 'Convert # to H2', def: false, kind: 'h2',
          help: 'make box tag into heading',
          tagsKey: 'convertH2Tags', expandKey: '_h2_expanded',
          subKey: 'promoteH2', subLabel: 'Promote to top level',
          subHelp: 'outdent body, space headers' },
        { id: 'stripHashtags',      label: 'Remove Hashtags',   def: true, sepAfter: true },
        { id: 'capitalizeHashtags', label: 'Capitalize',        def: false },
        { id: 'dashesToSpaces',     label: 'Dashes to Spaces',  def: false },
      ],
    },
    {
      id: 'cleanup',
      label: 'Cleanup',
      collapsed: false,
      toggles: [
        { id: 'removeLinks',      label: 'Remove links',         def: true },
        { id: 'removeHighlights', label: 'Remove == highlights', def: true },
      ],
    },
    {
      id: 'notes',
      label: 'Notes',
      collapsed: false,
      toggles: [
        { id: 'cleanNotes', label: 'Clean note blockquotes', def: true },
      ],
    },
    {
      id: 'blockquotes',
      label: 'Block Quotes',
      collapsed: false,
      toggles: [
        { id: 'bqRemoveBullets', label: 'Remove Bullets', def: false },
        { id: 'bqJoinSiblings', label: 'Join Root Siblings', def: false,
          help: 'blank between root quotes becomes a quote line' },
        { id: 'bqAddLineBetween', label: 'Add  Line Between', def: false,
          help: 'inserts a quote line between adjacent non-root quotes' },
      ],
    },
    {
      id: 'codeblocks',
      label: 'Code Blocks',
      collapsed: false,
      toggles: [
        { id: 'removeCodeBullets', label: 'Remove bullets', def: false },
      ],
    },
  ];

  function defaults() {
    const o = { _collapsed: false };
    SECTIONS.forEach(sec => {
      o['_sec_' + sec.id] = !!sec.collapsed;
      sec.toggles.forEach(t => {
        o[t.id] = t.def;
        if (t.kind === 'h2') {
          o[t.tagsKey] = '';
          o[t.expandKey] = false;
          if (t.subKey) o[t.subKey] = false;
        }
      });
    });
    return o;
  }
  function loadState() {
    try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
    catch (e) { return defaults(); }
  }
  function saveState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  let state = loadState();

  // ----------------------------------------------------------------------
  // Toggle panel UI
  // ----------------------------------------------------------------------
  function injectStyleOnce() {
    if (document.getElementById('wf-export-toggle-style')) return;
    const css = `
#wf-export-toggle-panel{position:fixed;bottom:16px;right:16px;z-index:2147483647;width:224px;background:#1e1e1e;color:#eee;font:12px/1.4 -apple-system,system-ui,Segoe UI,sans-serif;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.45);user-select:none}
#wf-export-toggle-panel .wf-h{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;cursor:pointer;font-weight:600;border-bottom:1px solid #3a3a3a}
#wf-export-toggle-panel.wf-collapsed .wf-h{border-bottom:none}
#wf-export-toggle-panel .wf-h .wf-caret{opacity:.7;font-size:10px}
#wf-export-toggle-panel .wf-b{padding:8px 10px;display:flex;flex-direction:column;gap:10px}
/* one shared left edge (16px gutter) for section names + option labels; carets live in the gutter */
#wf-export-toggle-panel .wf-section-h{position:relative;padding-left:16px;display:flex;align-items:center;cursor:pointer;font-weight:600}
#wf-export-toggle-panel .wf-row{position:relative;padding-left:16px;display:flex;justify-content:space-between;align-items:center;gap:10px}
#wf-export-toggle-panel .wf-h2-h{position:relative;padding-left:16px;display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer;font-weight:400}
#wf-export-toggle-panel .wf-sec-caret,#wf-export-toggle-panel .wf-h2-caret{position:absolute;left:2px;top:50%;transform:translateY(-50%);opacity:.7;font-size:9px;width:9px;text-align:center}
#wf-export-toggle-panel .wf-section-b{display:flex;flex-direction:column;gap:8px;margin-top:8px}
#wf-export-toggle-panel .wf-sep{height:1px;background:#3a3a3a;margin:1px 0 1px 16px}
#wf-export-toggle-panel .wf-help{font-size:10px;opacity:.45;font-weight:400;line-height:1.25;margin-top:2px}
#wf-export-toggle-panel .wf-h2-help{padding-left:16px}
#wf-export-toggle-panel .wf-h2-b{padding-left:16px;padding-top:6px}
#wf-export-toggle-panel .wf-h2-sub{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px}
#wf-export-toggle-panel .wf-ta{width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #3a3a3a;border-radius:5px;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px 6px;resize:vertical;min-height:46px}
#wf-export-toggle-panel .wf-switch{position:relative;width:34px;height:18px;flex:0 0 auto}
#wf-export-toggle-panel .wf-switch input{opacity:0;width:0;height:0;margin:0}
#wf-export-toggle-panel .wf-slider{position:absolute;inset:0;background:#555;border-radius:18px;transition:.15s;cursor:pointer}
#wf-export-toggle-panel .wf-slider:before{content:"";position:absolute;height:14px;width:14px;left:2px;top:2px;background:#fff;border-radius:50%;transition:.15s}
#wf-export-toggle-panel .wf-switch input:checked + .wf-slider{background:#2d8cff}
#wf-export-toggle-panel .wf-switch input:checked + .wf-slider:before{transform:translateX(16px)}
/* smooth open/close via animatable grid rows (.2s) */
#wf-export-toggle-panel .wf-collapse{display:grid;grid-template-rows:1fr;transition:grid-template-rows .2s ease}
#wf-export-toggle-panel .wf-collapse-inner{overflow:hidden;min-height:0}
#wf-export-toggle-panel.wf-collapsed .wf-body-collapse{grid-template-rows:0fr}
#wf-export-toggle-panel .wf-section.wf-sec-collapsed .wf-section-collapse{grid-template-rows:0fr}
#wf-export-toggle-panel .wf-h2.wf-h2-collapsed .wf-h2-collapse{grid-template-rows:0fr}
/* open section: faint outline + slightly darker bg to show its content grouping (box-shadow, so layout is unaffected) */
#wf-export-toggle-panel .wf-section:not(.wf-sec-collapsed){background:rgba(255,255,255,.025);border-radius:8px;box-shadow:0 0 0 1px rgba(255,255,255,.09)}`;
    const style = document.createElement('style');
    style.id = 'wf-export-toggle-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function applyCollapsed(panel) {
    panel.classList.toggle('wf-collapsed', !!state._collapsed);
    const caret = panel.querySelector('.wf-caret');
    if (caret) caret.textContent = state._collapsed ? '\u25B2' : '\u25BC';
  }

  // A toggle switch bound to a state key (returns a <label>).
  function makeSwitch(key) {
    const sw = document.createElement('label');
    sw.className = 'wf-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!state[key];
    input.addEventListener('change', () => { state[key] = input.checked; saveState(state); });
    const slider = document.createElement('span');
    slider.className = 'wf-slider';
    sw.appendChild(input);
    sw.appendChild(slider);
    return sw;
  }

  function buildToggleRow(def) {
    const row = document.createElement('label');
    row.className = 'wf-row';
    const text = document.createElement('span');
    text.textContent = def.label;
    const sw = document.createElement('span');
    sw.className = 'wf-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!state[def.id];
    input.addEventListener('change', () => { state[def.id] = input.checked; saveState(state); });
    const slider = document.createElement('span');
    slider.className = 'wf-slider';
    sw.appendChild(input);
    sw.appendChild(slider);
    row.appendChild(text);
    row.appendChild(sw);
    if (!def.help) return row;
    // optional faint helper under the label (same look as the H2 helper)
    const wrap = document.createElement('div');
    wrap.appendChild(row);
    const help = document.createElement('div');
    help.className = 'wf-help wf-h2-help';
    help.textContent = def.help;
    wrap.appendChild(help);
    return wrap;
  }

  function buildH2Row(def) {
    const wrap = document.createElement('div');
    wrap.className = 'wf-h2';

    const head = document.createElement('div');
    head.className = 'wf-h2-h';
    const caret = document.createElement('span');
    caret.className = 'wf-h2-caret';
    const label = document.createElement('span');
    label.textContent = def.label;
    const sw = makeSwitch(def.id);
    sw.addEventListener('click', e => e.stopPropagation()); // toggling on/off must not expand
    head.appendChild(caret);
    head.appendChild(label);
    head.appendChild(sw);

    // faint helper under the label, always visible
    let help = null;
    if (def.help) {
      help = document.createElement('div');
      help.className = 'wf-help wf-h2-help';
      help.textContent = def.help;
    }

    const collapse = document.createElement('div');
    collapse.className = 'wf-collapse wf-h2-collapse';
    const inner = document.createElement('div');
    inner.className = 'wf-collapse-inner';
    const body = document.createElement('div');
    body.className = 'wf-h2-b';

    const ta = document.createElement('textarea');
    ta.className = 'wf-ta';
    ta.placeholder = '#context,#task,';
    ta.value = state[def.tagsKey] || '';
    ta.addEventListener('input', () => { state[def.tagsKey] = ta.value; saveState(state); });
    ta.addEventListener('click', e => e.stopPropagation());
    body.appendChild(ta);

    // nested sub-option (e.g. Promote to top level) with its own switch + helper
    if (def.subKey) {
      const sub = document.createElement('div');
      sub.className = 'wf-h2-sub';
      const subLabel = document.createElement('span');
      subLabel.textContent = def.subLabel;
      const subSw = makeSwitch(def.subKey);
      subSw.addEventListener('click', e => e.stopPropagation());
      sub.appendChild(subLabel);
      sub.appendChild(subSw);
      body.appendChild(sub);
      if (def.subHelp) {
        const sh = document.createElement('div');
        sh.className = 'wf-help';
        sh.textContent = def.subHelp;
        body.appendChild(sh);
      }
    }

    inner.appendChild(body);
    collapse.appendChild(inner);

    function applyH2() {
      const collapsed = !state[def.expandKey];
      wrap.classList.toggle('wf-h2-collapsed', collapsed);
      caret.textContent = collapsed ? '\u25B8' : '\u25BE';
    }
    head.addEventListener('click', () => {
      state[def.expandKey] = !state[def.expandKey];
      saveState(state);
      applyH2();
    });

    wrap.appendChild(head);
    if (help) wrap.appendChild(help);
    wrap.appendChild(collapse);
    applyH2();
    return wrap;
  }

  function buildSection(sec) {
    const section = document.createElement('div');
    section.className = 'wf-section';

    const head = document.createElement('div');
    head.className = 'wf-section-h';
    const caret = document.createElement('span');
    caret.className = 'wf-sec-caret';
    const label = document.createElement('span');
    label.textContent = sec.label;
    head.appendChild(caret);
    head.appendChild(label);

    const collapse = document.createElement('div');
    collapse.className = 'wf-collapse wf-section-collapse';
    const inner = document.createElement('div');
    inner.className = 'wf-collapse-inner';
    const sbody = document.createElement('div');
    sbody.className = 'wf-section-b';
    sec.toggles.forEach(def => {
      sbody.appendChild(def.kind === 'h2' ? buildH2Row(def) : buildToggleRow(def));
      if (def.sepAfter) {
        const sep = document.createElement('div');
        sep.className = 'wf-sep';
        sbody.appendChild(sep);
      }
    });
    inner.appendChild(sbody);
    collapse.appendChild(inner);

    const secKey = '_sec_' + sec.id;
    function applySec() {
      const collapsed = !!state[secKey];
      section.classList.toggle('wf-sec-collapsed', collapsed);
      caret.textContent = collapsed ? '\u25B8' : '\u25BE';
    }
    head.addEventListener('click', () => {
      state[secKey] = !state[secKey];
      saveState(state);
      applySec();
    });

    section.appendChild(head);
    section.appendChild(collapse);
    applySec();
    return section;
  }

  function ensurePanel(host) {
    if (document.getElementById('wf-export-toggle-panel')) return;
    if (!host) return;
    injectStyleOnce();

    const panel = document.createElement('div');
    panel.id = 'wf-export-toggle-panel';

    const header = document.createElement('div');
    header.className = 'wf-h';
    header.innerHTML = '<span>Export options</span><span class="wf-caret"></span>';
    header.addEventListener('click', () => {
      state._collapsed = !state._collapsed;
      saveState(state);
      applyCollapsed(panel);
    });
    panel.appendChild(header);

    const collapse = document.createElement('div');
    collapse.className = 'wf-collapse wf-body-collapse';
    const inner = document.createElement('div');
    inner.className = 'wf-collapse-inner';
    const body = document.createElement('div');
    body.className = 'wf-b';
    SECTIONS.forEach(sec => body.appendChild(buildSection(sec)));
    inner.appendChild(body);
    collapse.appendChild(inner);
    panel.appendChild(collapse);

    host.appendChild(panel);
    applyCollapsed(panel);
  }

  function removePanel() {
    const panel = document.getElementById('wf-export-toggle-panel');
    if (panel) panel.remove();
  }

  // ----------------------------------------------------------------------
  // Helpers for the Hashtags rules
  // ----------------------------------------------------------------------
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Convert separators to spaces, collapse whitespace, capitalize each word.
  function toHeading(t) {
    return t
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(^|\s)([a-zA-Z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  }

  // Promote top-level H2 list items to real headings:
  //   - strip the leading "- " before "## ...",
  //   - outdent the heading's body one level,
  //   - blank line above each heading after the first, and below every heading.
  function promoteH2Headings(text) {
    const lines = text.split('\n');
    const out = [];
    let inBlock = false;
    for (const line of lines) {
      const head = /^- (## .+?)\s*$/.exec(line); // top-level converted heading
      if (head) {
        if (out.length && out[out.length - 1] !== '') out.push(''); // blank above (not first)
        out.push(head[1]);                                          // drop "- "
        out.push('');                                              // blank below
        inBlock = true;
        continue;
      }
      if (inBlock) {
        if (/^\t/.test(line)) { out.push(line.replace(/^\t/, '')); continue; } // outdent one level
        inBlock = false; // top-level non-heading line ends the block
      }
      out.push(line);
    }
    return out.join('\n');
  }

  // ----------------------------------------------------------------------
  // Block Quotes (TOGGLES: bqRemoveBullets / bqJoinSiblings / bqAddLineBetween)
  //
  // Export shapes this handles:
  //   - An indented blockquote node is a bullet whose content starts with ">"
  //     ("<indent>- > text"). A NOTE under it is a deeper-indented "> text"
  //     line (no "- "). Root-level blockquotes are plain column-0 "> text".
  //
  // Remove Bullets: strip the "- " from each blockquote bullet, and pull any
  // note under a blockquote up to that blockquote's level. The whole run is
  // pulled to a placeholder (carrying tab depth) BEFORE other rules, then
  // rebuilt at the end, so neither cleanNotes nor the tab-normalizer touch it.
  //
  // Join Root Siblings: at the root level only, a blank line sitting between
  // two column-0 "> " lines becomes an empty "> " line (merging the two into
  // one quote). Those root quote runs are also placeholder-protected.
  //
  // Add Line Between: at non-root level, two directly-adjacent blockquote
  // bullets at the same indent get an empty "<indent>- >" line inserted between
  // them. Skipped where a blank already separates them.
  // ----------------------------------------------------------------------
  const BQ_BULLET = /^( *)[-*+]\s+>(.*)$/;   // indented blockquote bullet: "<indent>- > rest"
  const BQ_NOTE   = /^( +)>(.*)$/;           // indented note under a blockquote: "<indent>> rest"
  const BQ_ROOT   = /^>(.*)$/;               // root-level blockquote line: "> rest" / ">"

  function codeRegionSet(lines) {
    const s = new Set();
    let i = 0;
    while (i < lines.length) {
      const m = CB_OPEN.exec(lines[i]);
      if (m) {
        let j = i + 1;
        while (j < lines.length && !CB_FENCE.test(lines[j])) j++;
        if (j < lines.length) { for (let k = i; k <= j; k++) s.add(k); i = j + 1; continue; }
      }
      i++;
    }
    return s;
  }

  function handleBlockquotes(text, st) {
    if (!st.bqRemoveBullets && !st.bqJoinSiblings && !st.bqAddLineBetween) return { text, blocks: [] };

    let lines = text.split('\n');
    let codeSet = codeRegionSet(lines);

    // Join Root Siblings: blank between two root "> " lines -> ">".
    // (No lines added/removed, so codeSet indices stay valid.)
    if (st.bqJoinSiblings) {
      for (let i = 1; i < lines.length - 1; i++) {
        if (codeSet.has(i)) continue;
        if (lines[i].trim() === '' && BQ_ROOT.test(lines[i - 1] || '') && BQ_ROOT.test(lines[i + 1] || '')) {
          lines[i] = '>';
        }
      }
    }

    // Add Line Between: insert "<indent>- >" between two directly-adjacent
    // blockquote bullets at the same indent. (Inserts lines -> recompute codeSet.)
    if (st.bqAddLineBetween) {
      const ins = [];
      for (let i = 0; i < lines.length; i++) {
        ins.push(lines[i]);
        if (i + 1 < lines.length && !codeSet.has(i) && !codeSet.has(i + 1)) {
          const a = BQ_BULLET.exec(lines[i]);
          const b = BQ_BULLET.exec(lines[i + 1]);
          if (a && b && (a[1] || '').length === (b[1] || '').length) ins.push((a[1] || '') + '- >');
        }
      }
      lines = ins;
      codeSet = codeRegionSet(lines);
    }

    const blocks = [];
    const out = [];
    let i = 0;
    while (i < lines.length) {
      if (codeSet.has(i)) { out.push(lines[i]); i++; continue; }

      // Remove Bullets: a run of blockquote bullets (+ their notes)
      if (st.bqRemoveBullets && BQ_BULLET.test(lines[i])) {
        const run = [];               // { depth, text } ; text is "> ..."
        let lastBulletDepth = Math.floor((BQ_BULLET.exec(lines[i])[1] || '').length / 2);
        let j = i;
        while (j < lines.length && !codeSet.has(j)) {
          const b = BQ_BULLET.exec(lines[j]);
          const n = BQ_NOTE.exec(lines[j]);
          if (b) { lastBulletDepth = Math.floor((b[1] || '').length / 2); run.push({ depth: lastBulletDepth, text: '>' + b[2] }); j++; }
          else if (n) { run.push({ depth: lastBulletDepth, text: '>' + n[2] }); j++; } // note -> bullet level
          else break;
        }
        const minDepth = Math.min.apply(null, run.map(r => r.depth));
        blocks.push({ kind: 'bq', lines: run.map(r => ({ off: r.depth - minDepth, text: r.text })) });
        out.push('\t'.repeat(minDepth) + '\u0000QB' + (blocks.length - 1) + '\u0000');
        i = j; continue;
      }

      // Join: a run of root-level "> " lines -> placeholder (protect from cleanNotes)
      if (st.bqJoinSiblings && BQ_ROOT.test(lines[i])) {
        const run = [];
        let j = i;
        while (j < lines.length && !codeSet.has(j) && BQ_ROOT.test(lines[j])) { run.push(lines[j]); j++; }
        blocks.push({ kind: 'root', lines: run });
        out.push('\u0000QB' + (blocks.length - 1) + '\u0000');
        i = j; continue;
      }

      out.push(lines[i]); i++;
    }
    return { text: out.join('\n'), blocks };
  }

  function restoreBlockquotes(text, blocks) {
    if (!blocks.length) return text;
    return text.split('\n').map(line => {
      const m = /^(\t*)\u0000QB(\d+)\u0000\s*$/.exec(line);
      if (!m) return line;
      const indent = m[1];
      const b = blocks[+m[2]];
      if (b.kind === 'root') return b.lines.map(l => l.replace(/\s+$/, '')).join('\n');
      return b.lines.map(r => indent + '\t'.repeat(r.off) + r.text.replace(/\s+$/, '')).join('\n');
    }).join('\n');
  }


  // carries the fence's tab depth, so it still rides along through the
  // indentation passes (e.g. H2 promote outdents it with its siblings); the
  // block is rebuilt at whatever indent the placeholder ends up at.
  // ----------------------------------------------------------------------
  const CB_OPEN = /^( *)([-*+]|\d+\.)\s+(```.*?)\s*$/;
  const CB_FENCE = /^\s*```\s*$/;

  function extractCodeBlocks(text, enabled) {
    if (!enabled) return { text, blocks: [] };
    const lines = text.split('\n');
    const out = [];
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const m = CB_OPEN.exec(lines[i]);
      if (m) {
        let j = i + 1;
        while (j < lines.length && !CB_FENCE.test(lines[j])) j++;
        if (j < lines.length) { // found closing fence -> it's a code block
          const ordered = /\d+\./.test(m[2]);
          const depth = ordered ? Math.floor(m[1].length / 4) : Math.floor(m[1].length / 2);
          blocks.push({ fence: m[3], content: lines.slice(i + 1, j) });
          out.push('\t'.repeat(depth) + '\u0000CB' + (blocks.length - 1) + '\u0000');
          i = j + 1;
          continue;
        }
      }
      out.push(lines[i]);
      i++;
    }
    return { text: out.join('\n'), blocks };
  }

  function restoreCodeBlocks(text, blocks) {
    if (!blocks.length) return text;
    return text.split('\n').map(line => {
      const m = /^(\t*)\u0000CB(\d+)\u0000\s*$/.exec(line);
      if (!m) return line;
      const indent = m[1];
      const b = blocks[+m[2]];
      const rebuilt = [indent + b.fence];
      for (const c of b.content) rebuilt.push(c === '' ? '' : indent + c);
      rebuilt.push(indent + '```');
      return rebuilt.join('\n');
    }).join('\n');
  }

  // ----------------------------------------------------------------------
  // Rule 5 (ALWAYS ON): normalize list indentation to tabs.
  // Workflowy indents ordered items 4 spaces/level and unordered 2/level.
  // ----------------------------------------------------------------------
  function normalizeListIndentation(text) {
    const lines = text.split('\n');
    const out = [];
    let lastDepth = 0;

    for (const line of lines) {
      const m = line.match(/^( *)(\d+\.|[-*+])(\s+)(.*)$/);
      if (m) {
        const spaces = m[1].length;
        const isOrdered = /^\d+\.$/.test(m[2]);
        const depth = isOrdered ? Math.floor(spaces / 4) : Math.floor(spaces / 2);
        const marker = isOrdered ? m[2] : '-';
        out.push('\t'.repeat(depth) + marker + ' ' + m[4]);
        lastDepth = depth;
        continue;
      }
      if (line.trim() === '') { out.push(line); continue; }
      if (/^ /.test(line)) {
        const stripped = line.replace(/^ +/, '');
        // A note ("> ...") belongs to the bullet above it, so it sits at that
        // bullet's level (lastDepth) rather than one level deeper.
        const depth = /^>/.test(stripped) ? lastDepth : lastDepth + 1;
        out.push('\t'.repeat(depth) + stripped);
        continue;
      }
      out.push(line);
      lastDepth = 0;
    }
    return out.join('\n');
  }

  // ----------------------------------------------------------------------
  // process text: apply transformations to exported markdown
  // ----------------------------------------------------------------------
  function processText(text) {
    state = loadState(); // pick up current toggle positions at copy time

    // Block quotes first: pull blockquote runs to placeholders (and join root
    // siblings) before anything else. No-op when both toggles are off.
    const bq = handleBlockquotes(text, state);

    // Pull code blocks out next so no other rule (or the tab-normalizer) touches them.
    const extracted = extractCodeBlocks(bq.text, !!state.removeCodeBullets);
    const lines = extracted.text.split('\n');
    const result = [];

    // Tags listed in the H2 textarea (normalized: no leading #, no blanks).
    const h2Tags = state.convertH2
      ? (state.convertH2Tags || '').split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean)
      : [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';
      const prevTrimmed = prevLine.trim();

      // Notes (TOGGLE: cleanNotes): note blockquote cleaning
      if (state.cleanNotes) {
        // Delete line if it's only '> '
        if (/^\s*>\s*$/.test(line)) continue;

        // Remove leading '> ' unless exception
        const isFirstLine = i === 0;
        const isDashBlockquote = /^\s*-\s*> /.test(line);
        const blankAbove = prevTrimmed === '';

        if (!isFirstLine && !blankAbove && !isDashBlockquote && /^\s*> /.test(line)) {
          const prevIndent = (prevLine.match(/^\s*/)[0] || '').length;
          let addSpaces = 3;
          if (/^\s*-\s*> /.test(prevLine)) addSpaces = 6;
          else if (/^\s*- /.test(prevLine)) addSpaces = 3;
          else if (/^\s*> /.test(prevLine)) addSpaces = 3;
          const totalIndent = ' '.repeat(prevIndent + addSpaces);
          line = line.replace(/^\s*>\s?/, totalIndent);
        }
      }

      // Cleanup (TOGGLE: removeLinks): Remove markdown links (keep visible text only)
      if (state.removeLinks) {
        while (/\[[^\]]+\]\([^\)]+\)/.test(line)) {
          line = line.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '$1');
        }
      }

      // ----- Hashtags section -----
      // A "tag" = '#' + hashtag text ([A-Za-z0-9_-]+, ends at a space).
      // Order: Convert # to H2 -> Capitalize -> Dashes to Spaces -> Remove,
      // so listed tags become headings and the rest are processed once.

      // Convert # to H2 (TOGGLE): listed tags -> '## Heading'
      //   #context: -> ## Context:
      if (h2Tags.length) {
        for (const t of h2Tags) {
          const re = new RegExp('#' + escapeRegex(t) + '(?![A-Za-z0-9_-])', 'gi');
          line = line.replace(re, '## ' + toHeading(t));
        }
      }

      // Capitalize (TOGGLE)
      if (state.capitalizeHashtags) {
        line = line.replace(/#([A-Za-z0-9_-]+)/g, (m, t) =>
          '#' + t.replace(/(^|-)([a-zA-Z])/g, (mm, sep, ch) => sep + ch.toUpperCase()));
      }

      // Dashes to Spaces (TOGGLE)
      if (state.dashesToSpaces) {
        line = line.replace(/#([A-Za-z0-9_-]+)/g, (m, t) => '#' + t.replace(/-/g, ' '));
      }

      // Remove Hashtags (TOGGLE): drop '#' unless followed by a number
      if (state.stripHashtags) {
        line = line.replace(/#(?!\d)([A-Za-z0-9_-]+)/g, '$1');
      }

      // Cleanup (TOGGLE: removeHighlights): Remove all instances of '=='
      if (state.removeHighlights) {
        line = line.replace(/==/g, '');
      }

      result.push(line);
    }

    // Rule 5 (ALWAYS ON): normalize list indentation to tabs
    let outText = normalizeListIndentation(result.join('\n'));

    // Promote to top level (TOGGLE, sub-option of Convert # to H2)
    if (state.convertH2 && state.promoteH2) {
      outText = promoteH2Headings(outText);
    }

    // Rebuild code blocks at their final indentation.
    outText = restoreCodeBlocks(outText, extracted.blocks);

    // Rebuild block quotes (placeholders) at their final indentation.
    outText = restoreBlockquotes(outText, bq.blocks);

    return outText;
  }

  // ----------------------------------------------------------------------
  // Copy mechanism (rewritten in v4.0 for the current Workflowy).
  //
  // Workflowy's export dialog no longer exposes the text in a <textarea>:
  // the preview lives in a sandboxed, cross-origin blob: <iframe> we can't
  // read, and the dialog's "Copy" button hands the export string to
  // navigator.clipboard.write() as a ClipboardItem. So instead of reading the
  // DOM, we intercept that write: when OUR trigger armed the flag, we pull the
  // text/plain out, run processText() on it, and put the transformed text on
  // the clipboard. Workflowy's own Copy button leaves the flag off, so it
  // stays a raw copy.
  //
  //   - native "Copy"          -> raw (untouched)
  //   - "Copy (mod)" / Cmd+C   -> transformed, but ONLY on the Markdown tab
  //   - dialog opens           -> Markdown tab selected once
  //
  // The only Workflowy-specific handles here are button TEXT ("Copy",
  // "Markdown", ...), which is far more stable than its CSS class names.
  // ----------------------------------------------------------------------

  let transformNextCopy = false;
  const clip = navigator.clipboard;
  const origClipboardWrite = (clip && clip.write) ? clip.write.bind(clip) : null;
  if (origClipboardWrite) {
    clip.write = function (items) {
      if (!transformNextCopy) return origClipboardWrite(items);
      transformNextCopy = false;
      try {
        // ClipboardItem accepts a Promise value, so we can build the
        // transformed item synchronously (keeping the click's user gesture)
        // and let the browser await processText() as the blob resolves.
        const rebuilt = Array.from(items || []).map(item => {
          const parts = {};
          item.types.forEach(type => {
            parts[type] = (type === 'text/plain')
              ? item.getType(type).then(b => b.text())
                  .then(t => new Blob([processText(t)], { type: 'text/plain' }))
              : item.getType(type);
          });
          return new ClipboardItem(parts);
        });
        return origClipboardWrite(rebuilt);
      } catch (err) {
        console.error('WF export (mod): transform failed, copying raw', err);
        return origClipboardWrite(items);
      }
    };
  }

  // --- small helpers over the export dialog ---------------------------------
  const FORMATS = ['Formatted', 'Markdown', 'Plain Text', 'OPML'];
  const btnText = b => (b.textContent || '').trim();
  const formatTabs = dialog =>
    Array.from(dialog.querySelectorAll('button')).filter(b => FORMATS.includes(btnText(b)));
  // Exact "Copy" match, so it never picks up our own "Copy (mod)" button.
  const nativeCopyBtn = dialog =>
    Array.from(dialog.querySelectorAll('button')).find(b => btnText(b) === 'Copy');

  function luminance(rgb) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
    return m ? 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3] : -1;
  }
  // The selected format tab is the odd one out: it drops the "!bg-primary"
  // class and paints a lighter background. Prefer the class signal; if that's
  // ambiguous, fall back to "lightest background wins".
  function selectedTab(dialog) {
    const tabs = formatTabs(dialog);
    if (!tabs.length) return null;
    const lit = tabs.filter(b => !b.className.includes('!bg-primary'));
    if (lit.length === 1) return lit[0];
    let best = null, bestL = -1;
    tabs.forEach(b => {
      const L = luminance(getComputedStyle(b).backgroundColor);
      if (L > bestL) { bestL = L; best = b; }
    });
    return best;
  }
  const isMarkdownSelected = dialog => {
    const sel = selectedTab(dialog);
    return !!sel && btnText(sel) === 'Markdown';
  };

  function triggerModCopy(dialog) {
    const copyBtn = nativeCopyBtn(dialog);
    if (!copyBtn) return;
    transformNextCopy = true;
    copyBtn.click();
    // Safety: never leave the flag armed for a later native copy.
    setTimeout(() => { transformNextCopy = false; }, 1000);
  }

  // Green "Copy (mod)" button beside the native Copy; greyed off the Markdown tab.
  function updateModButton(dialog) {
    const mod = document.getElementById('wf-copy-mod-btn');
    if (!mod) return;
    const on = isMarkdownSelected(dialog);
    mod.disabled = !on; // a disabled button won't fire click, so off-Markdown = inert
    mod.style.setProperty('opacity', on ? '1' : '0.4', 'important');
    mod.style.setProperty('cursor', on ? 'pointer' : 'not-allowed', 'important');
    mod.style.setProperty('background', on ? '#1f9d55' : '#3a3a3a', 'important');
  }
  function ensureModButton(dialog) {
    if (document.getElementById('wf-copy-mod-btn')) return;
    const copyBtn = nativeCopyBtn(dialog);
    if (!copyBtn) return;
    const mod = document.createElement('button');
    mod.id = 'wf-copy-mod-btn';
    mod.type = 'button';
    mod.textContent = 'Copy (mod)';
    mod.className = copyBtn.className; // borrow Workflowy's button sizing/shape
    mod.style.setProperty('color', '#fff', 'important');
    mod.style.setProperty('margin-left', '8px', 'important');
    mod.addEventListener('click', e => {
      e.preventDefault();
      if (isMarkdownSelected(dialog)) triggerModCopy(dialog);
    });
    copyBtn.insertAdjacentElement('afterend', mod);
    updateModButton(dialog);
  }

  // Pick the Markdown tab once, the first time this dialog renders its tabs.
  function autoSelectMarkdown(dialog) {
    if (dialog._wfMarkdownDefaulted) return;
    const tabs = formatTabs(dialog);
    if (!tabs.length) return; // tabs not rendered yet -> retry on the next observer tick
    dialog._wfMarkdownDefaulted = true;
    const md = tabs.find(b => btnText(b) === 'Markdown');
    if (md && selectedTab(dialog) !== md) md.click();
  }

  // Cmd/Ctrl+C inside the dialog behaves like "Copy (mod)" -- Markdown tab only.
  // (Workflowy no longer selects the export text, so there's nothing for a
  // plain Cmd+C to copy; we supply the gesture the old auto-select used to.)
  document.addEventListener('keydown', e => {
    const isCopy = (e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
    if (!isCopy) return;
    const dialog = document.querySelector('.dialog-backdrop');
    if (!dialog) return;
    // Let copies inside our own panel (the H2 tag box) behave normally.
    if (e.target && e.target.closest && e.target.closest('#wf-export-toggle-panel')) return;
    if (!isMarkdownSelected(dialog)) return; // off Markdown: stay out of the way
    e.preventDefault();
    triggerModCopy(dialog);
  }, true);

  // ----------------------------------------------------------------------
  // Observer: show the panel + wire the dialog whenever the export dialog is up.
  // ----------------------------------------------------------------------
  const observer = new MutationObserver(() => {
    const dialog = document.querySelector('.flex.items-start.justify-center.dialog-backdrop')
      || document.querySelector('.dialog-backdrop');

    if (!dialog) { removePanel(); return; }
    ensurePanel(dialog);

    // Only the export dialog has the format tabs; other dialogs are left alone.
    if (!formatTabs(dialog).length) return;

    autoSelectMarkdown(dialog);
    ensureModButton(dialog);
    updateModButton(dialog);

    if (!dialog._wfModWired) {
      dialog._wfModWired = true;
      // A tab click changes which format is selected; refresh the button state.
      dialog.addEventListener('click', () => setTimeout(() => updateModButton(dialog), 60), true);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();