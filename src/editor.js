// 블록 에디터: 블록마다 contenteditable 한 줄. 서식 없는 텍스트만 저장한다.
import { el, toast, actionSheet } from './ui.js';
import { newBlock } from './store.js';

const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'bullet', 'number', 'todo', 'quote', 'callout', 'toggle']);
const LIST_TYPES = new Set(['bullet', 'number', 'todo']);

export const BLOCK_TYPES = [
  { type: 'p', label: '텍스트', hint: '일반 문단', icon: 'T', keys: ['text', 'p', '텍스트', '본문'] },
  { type: 'page', label: '페이지', hint: '이 안에 하위 페이지 만들기', icon: '▤', keys: ['page', 'sub', '페이지', '하위'] },
  { type: 'h1', label: '제목', hint: '큰 제목', icon: 'H1', keys: ['h1', 'heading', '제목'] },
  { type: 'h2', label: '소제목', hint: '작은 제목', icon: 'H2', keys: ['h2', '소제목'] },
  { type: 'bullet', label: '목록', hint: '글머리 기호', icon: '•', keys: ['list', 'bullet', 'ul', '목록'] },
  { type: 'number', label: '번호 목록', hint: '1. 2. 3.', icon: '1.', keys: ['number', 'ol', 'num', '번호'] },
  { type: 'todo', label: '체크리스트', hint: '할 일', icon: '☐', keys: ['todo', 'check', '체크', '할일'] },
  { type: 'toggle', label: '토글', hint: '접었다 펴는 목록', icon: '▸', keys: ['toggle', '토글', '접기'] },
  { type: 'table', label: '표', hint: '간단한 표', icon: '▦', keys: ['table', '표'] },
  { type: 'quote', label: '인용', hint: '인용문', icon: '❝', keys: ['quote', '인용'] },
  { type: 'callout', label: '콜아웃', hint: '아이콘이 있는 강조 상자', icon: '💡', keys: ['callout', 'note', '콜아웃', '강조'] },
  { type: 'divider', label: '구분선', hint: '가로줄', icon: '—', keys: ['divider', 'hr', 'line', '구분'] },
  { type: 'image', label: '이미지', hint: '사진 첨부', icon: '▣', keys: ['image', 'img', 'photo', '이미지', '사진'] },
];

const TOOLBAR = [['page', '페이지'], ['p', '본문'], ['h1', '제목'], ['h2', '소제목'], ['bullet', '목록'], ['number', '번호'], ['todo', '체크'], ['toggle', '토글'], ['table', '표'], ['quote', '인용'], ['callout', '콜아웃'], ['divider', '구분선'], ['image', '사진']];

const PLACEHOLDER = { p: "입력하거나 '/'로 블록 선택", h1: '제목', h2: '소제목', bullet: '목록', number: '목록', todo: '할 일', quote: '인용', callout: '내용 입력', toggle: '토글' };

const SHORTCUTS = [
  [/^#\s/, 'h1'], [/^##\s/, 'h2'], [/^[-*•]\s/, 'bullet'], [/^1[.)]\s/, 'number'], [/^\[[\sxX]?\]\s/, 'todo'], [/^>\s/, 'toggle'], [/^"\s/, 'quote'],
];

const EDITABLE = (() => {
  try {
    const d = document.createElement('div');
    d.contentEditable = 'plaintext-only';
    return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  } catch { return 'true'; }
})();

const clean = (s) => s.replace(/ /g, ' ');

function setCaret(node, offset) {
  const sel = window.getSelection();
  const range = document.createRange();
  let remaining = offset;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = walker.nextNode())) {
    if (remaining <= t.length) {
      range.setStart(t, remaining); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
      return;
    }
    remaining -= t.length;
  }
  range.selectNodeContents(node); range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range);
}

function caretOffset(node) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!node.contains(r.startContainer)) return 0;
  const pre = document.createRange();
  pre.selectNodeContents(node);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

const collapsed = () => { const s = window.getSelection(); return !s.rangeCount || s.isCollapsed; };

async function fileToDataURL(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

export function createEditor({ blocksEl, titleEl, toolbarEl, onChange, hooks = {} }) {
  let note = null;
  let readOnly = false;
  let activeId = null;
  let slash = null;           // { blockId, menu, items, index }
  let slashDismissed = null;  // Esc로 닫은 블록 id

  const blocks = () => (note ? note.blocks : []);
  const idx = (id) => blocks().findIndex((b) => b.id === id);
  const find = (id) => blocks()[idx(id)];
  const rowOf = (id) => blocksEl.querySelector(`.block[data-id="${CSS.escape(id)}"]`);
  const textOf = (id) => rowOf(id)?.querySelector('.text');
  const save = () => { if (note && !readOnly) onChange(note); };

  // ---------- 렌더링 ----------
  function renderBlock(b) {
    const row = buildRow(b);
    if (!readOnly) row.prepend(gutter(b.id));
    return row;
  }
  // 블록 왼쪽: + (아래에 블록 추가), ⋮⋮ (끌어서 이동 / 눌러서 메뉴)
  function gutter(id) {
    const plus = el('button', { type: 'button', class: 'g-btn', 'aria-label': '아래에 블록 추가', title: '아래에 블록 추가' }, '+');
    plus.addEventListener('mousedown', (e) => e.preventDefault());
    plus.addEventListener('click', () => { const nb = insertAfter(id, newBlock()); focusBlock(nb.id, 'start'); save(); });
    const handle = el('button', { type: 'button', class: 'g-btn g-handle', 'aria-label': '끌어서 이동, 눌러서 메뉴', title: '끌어서 이동 · 눌러서 메뉴' }, '⋮⋮');
    handle.addEventListener('pointerdown', (e) => startDrag(e, id));
    return el('div', { class: 'gutter', contenteditable: 'false' }, plus, handle);
  }
  const pageTitle = (p) => (p && !p.deleted ? (p.title || '').trim() || '제목 없음' : '삭제된 페이지');
  function buildRow(b) {
    const row = el('div', { class: `block block-${b.type}`, 'data-id': b.id });
    if (b.indent) row.style.setProperty('--indent', b.indent);
    if (b.type === 'table') {
      if (!Array.isArray(b.rows) || !b.rows.length) b.rows = [['', ''], ['', '']];
      const table = el('table', { class: 'tbl' });
      b.rows.forEach((r, ri) => {
        const tr = el('tr');
        r.forEach((c, ci) => {
          const cell = el(ri === 0 ? 'th' : 'td', { contenteditable: readOnly ? 'false' : EDITABLE, 'data-r': ri, 'data-c': ci, spellcheck: 'false' });
          cell.textContent = c || '';
          tr.append(cell);
        });
        table.append(tr);
      });
      const cellOf = (e) => e.target.closest && e.target.closest('[data-r]');
      const go = (r, c) => {
        if (r >= b.rows.length) { b.rows.push(new Array(b.rows[0].length).fill('')); replaceRow(b); save(); }
        focusCell(b.id, r, c);
      };
      table.addEventListener('input', (e) => {
        const td = cellOf(e); if (!td) return;
        if (td.textContent === '' && td.firstChild) td.textContent = '';
        b.rows[+td.dataset.r][+td.dataset.c] = clean(td.textContent); save();
      });
      table.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
          e.preventDefault(); const td = cellOf(e); if (td) go(+td.dataset.r + 1, +td.dataset.c);
        }
      });
      table.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229 || e.key !== 'Tab') return;
        const td = cellOf(e); if (!td) return;
        e.preventDefault(); e.stopPropagation();
        const cols = b.rows[0].length;
        let r = +td.dataset.r; let c = +td.dataset.c + (e.shiftKey ? -1 : 1);
        if (c >= cols) { c = 0; r += 1; }
        if (c < 0) { c = cols - 1; r -= 1; }
        if (r >= 0) go(r, c);
      });
      row.append(el('div', { class: 'table-wrap' }, table));
      if (!readOnly) {
        const act = (label, fn) => { const bt = el('button', { type: 'button' }, label); bt.addEventListener('mousedown', (e) => e.preventDefault()); bt.addEventListener('click', fn); return bt; };
        row.append(el('div', { class: 'tbl-actions' },
          act('+ 행', () => { b.rows.push(new Array(b.rows[0].length).fill('')); replaceRow(b); focusCell(b.id, b.rows.length - 1, 0); save(); }),
          act('+ 열', () => { b.rows.forEach((r) => r.push('')); replaceRow(b); focusCell(b.id, 0, b.rows[0].length - 1); save(); }),
          act('− 행', () => { if (b.rows.length > 1) { b.rows.pop(); replaceRow(b); save(); } }),
          act('− 열', () => { if (b.rows[0].length > 1) { b.rows.forEach((r) => r.pop()); replaceRow(b); save(); } })));
      }
      return row;
    }
    if (b.type === 'toggle') {
      const open = b.open !== false;
      const tg = el('button', { type: 'button', class: 'toggle-btn' + (open ? ' open' : ''), 'aria-label': open ? '접기' : '펼치기', contenteditable: 'false' }, '▶');
      tg.addEventListener('mousedown', (e) => e.preventDefault());
      tg.addEventListener('click', () => {
        b.open = b.open === false;
        tg.classList.toggle('open', b.open); tg.setAttribute('aria-label', b.open ? '접기' : '펼치기');
        renumber(); save();
      });
      row.append(tg);
    }
    if (b.type === 'page') {
      row.tabIndex = 0;
      const p = hooks.getPage ? hooks.getPage(b.page_id) : null;
      row.append(el('button', {
        type: 'button', class: 'page-link',
        onclick: () => { const q = hooks.getPage && hooks.getPage(b.page_id); if (q && !q.deleted && hooks.openPage) hooks.openPage(b.page_id); },
      }, el('span', { class: 'page-link-ico' }, (p && p.icon) || '📄'), el('span', { class: 'page-link-title' }, pageTitle(p))));
      return row;
    }
    if (b.type === 'callout') {
      const ic = el('button', { type: 'button', class: 'callout-ico', 'aria-label': '아이콘 바꾸기', contenteditable: 'false' }, b.icon || '💡');
      ic.addEventListener('mousedown', (e) => e.preventDefault());
      ic.addEventListener('click', () => {
        if (readOnly || !hooks.pickEmoji) return;
        hooks.pickEmoji((e) => { b.icon = e || '💡'; ic.textContent = b.icon; save(); });
      });
      row.append(ic);
    }
    if (b.type === 'divider') { row.tabIndex = 0; row.append(el('hr')); return row; }
    if (b.type === 'image') {
      row.tabIndex = 0;
      row.append(el('img', { src: b.src || '', alt: '', draggable: 'false' }));
      if (!readOnly) {
        row.append(el('button', {
          type: 'button', class: 'block-remove', 'aria-label': '이미지 삭제',
          onclick: () => { const i = idx(b.id); removeBlock(b.id); const p = blocks()[Math.max(0, i - 1)]; if (p) focusBlock(p.id, 'end'); save(); },
        }, '×'));
      }
      return row;
    }
    if (b.type === 'todo') {
      const cb = el('input', { type: 'checkbox', class: 'todo-check', 'aria-label': '완료', disabled: readOnly });
      cb.checked = !!b.checked;
      if (b.checked) row.classList.add('done');
      cb.addEventListener('change', () => { b.checked = cb.checked; row.classList.toggle('done', b.checked); save(); });
      row.append(cb);
    }
    if (b.type === 'bullet') row.append(el('span', { class: 'bullet-dot', 'aria-hidden': 'true' }, '•'));
    if (b.type === 'number') row.append(el('span', { class: 'num-mark', 'aria-hidden': 'true' }, '1.'));
    const t = el('div', {
      class: 'text', contenteditable: readOnly ? 'false' : EDITABLE,
      'data-placeholder': PLACEHOLDER[b.type] || '', spellcheck: 'false',
    });
    t.textContent = b.text || '';
    row.append(t);
    return row;
  }

  // 번호 목록: 연속된 번호 블록마다 1부터 다시 센다
  // 들여쓰기 기준으로 번호 매기기, 목록 기호, 접힌 토글 아래 블록 숨기기
  function renumber() {
    const rows = new Map([...blocksEl.children].map((r) => [r.dataset.id, r]));
    const counters = [];
    let hideBelow = null;
    for (const b of blocks()) {
      const row = rows.get(b.id); if (!row) continue;
      const ind = b.indent || 0;
      if (hideBelow !== null && ind <= hideBelow) hideBelow = null;
      row.hidden = hideBelow !== null;
      if (!row.hidden && b.type === 'toggle' && b.open === false) hideBelow = ind;
      counters.length = Math.min(counters.length, ind + 1);
      if (b.type === 'number') {
        counters[ind] = (counters[ind] || 0) + 1;
        const m = row.querySelector('.num-mark'); if (m) m.textContent = `${counters[ind]}.`;
      } else counters[ind] = 0;
      if (b.type === 'bullet') { const d = row.querySelector('.bullet-dot'); if (d) d.textContent = ['•', '◦', '▪'][ind % 3]; }
    }
  }
  function focusCell(id, r, c) {
    const td = rowOf(id)?.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (!td) return;
    td.focus(); setCaret(td, td.textContent.length); activeId = id; updateToolbar();
  }
  function indentBlock(id, dir) {
    const i = idx(id); const b = blocks()[i]; if (!b) return false;
    const cur = b.indent || 0;
    if (dir > 0) {
      const prev = blocks()[i - 1]; if (!prev) return false;
      if (cur >= Math.min(4, (prev.indent || 0) + 1)) return false;
      b.indent = cur + 1;
    } else {
      if (!cur) return false;
      b.indent = cur - 1;
    }
    const t = textOf(id);
    const off = t && document.activeElement === t ? caretOffset(t) : 'end';
    replaceRow(b); focusBlock(id, off); save();
    return true;
  }
  function render() {
    blocksEl.textContent = '';
    for (const b of blocks()) blocksEl.append(renderBlock(b));
    renumber();
  }
  function replaceRow(b) {
    const old = rowOf(b.id); const row = renderBlock(b);
    if (old) old.replaceWith(row); else blocksEl.append(row);
    renumber();
    return row;
  }
  function insertAfter(refId, b) {
    const i = idx(refId);
    blocks().splice(i + 1, 0, b);
    const ref = rowOf(refId); const row = renderBlock(b);
    if (ref) ref.after(row); else blocksEl.append(row);
    renumber();
    return b;
  }
  function insertBefore(refId, b) {
    const i = idx(refId);
    blocks().splice(Math.max(0, i), 0, b);
    const ref = rowOf(refId); const row = renderBlock(b);
    if (ref) ref.before(row); else blocksEl.prepend(row);
    renumber();
    return b;
  }
  function removeBlock(id) {
    const i = idx(id); if (i < 0) return;
    blocks().splice(i, 1);
    rowOf(id)?.remove();
    renumber();
    if (!blocks().length) { const b = newBlock(); blocks().push(b); blocksEl.append(renderBlock(b)); }
  }
  function focusBlock(id, pos = 'end') {
    const row = rowOf(id); if (!row) return;
    activeId = id;
    const t = row.querySelector('.text');
    if (!t) { row.focus(); updateToolbar(); return; }
    t.focus();
    const len = t.textContent.length;
    setCaret(t, pos === 'start' ? 0 : pos === 'end' ? len : Math.min(pos, len));
    updateToolbar();
  }

  // ---------- 블록 형식 변경 ----------
  function setType(id, type, toggle = false) {
    const b = find(id); if (!b) return;
    if (type === 'image') { pickImage(id); return; }
    if (type === 'table') {
      const rows = [['', '', ''], ['', '', ''], ['', '', '']];
      let tid = id;
      if (TEXT_TYPES.has(b.type) && !(b.text || '').trim()) { b.type = 'table'; b.rows = rows; b.text = ''; delete b.checked; replaceRow(b); }
      else tid = insertAfter(id, { ...newBlock('table'), rows }).id;
      if (!blocks()[idx(tid) + 1]) insertAfter(tid, newBlock());
      focusCell(tid, 0, 0); save();
      return;
    }
    if (type === 'page') {
      if (!hooks.createSubpage || !note) return;
      const child = hooks.createSubpage(note.id);
      if (TEXT_TYPES.has(b.type) && !(b.text || '').trim()) { b.type = 'page'; b.page_id = child.id; b.text = ''; delete b.checked; replaceRow(b); }
      else insertAfter(id, { ...newBlock('page'), page_id: child.id });
      save();
      if (hooks.openPage) hooks.openPage(child.id, { focus: 'title' });
      return;
    }
    if (type === 'divider') {
      let divId = id;
      if (TEXT_TYPES.has(b.type) && !(b.text || '').trim()) { b.type = 'divider'; b.text = ''; delete b.checked; replaceRow(b); }
      else divId = insertAfter(id, newBlock('divider')).id;
      let next = blocks()[idx(divId) + 1];
      if (!next || !TEXT_TYPES.has(next.type)) next = insertAfter(divId, newBlock());
      focusBlock(next.id, 'start'); save();
      return;
    }
    if (!TEXT_TYPES.has(b.type)) { const nb = insertAfter(id, newBlock(type)); focusBlock(nb.id, 'start'); save(); return; }
    const t = textOf(id);
    const off = t && document.activeElement === t ? caretOffset(t) : (b.text || '').length;
    b.type = toggle && b.type === type && type !== 'p' ? 'p' : type;
    if (b.type === 'todo') b.checked = !!b.checked; else delete b.checked;
    if (b.type === 'callout' && !b.icon) b.icon = '💡';
    replaceRow(b); focusBlock(id, off); save();
  }

  function applyShortcut(b, text) {
    if (text === '---') {
      b.type = 'divider'; b.text = ''; replaceRow(b);
      let next = blocks()[idx(b.id) + 1];
      if (!next || !TEXT_TYPES.has(next.type)) next = insertAfter(b.id, newBlock());
      focusBlock(next.id, 'start'); save();
      return true;
    }
    for (const [re, type] of SHORTCUTS) {
      const m = text.match(re);
      if (m) {
        b.type = type; b.text = text.slice(m[0].length);
        if (type === 'todo') b.checked = /x/i.test(m[0]);
        replaceRow(b); focusBlock(b.id, 'start'); save();
        return true;
      }
    }
    return false;
  }

  function splitAt(id) {
    const b = find(id); const t = textOf(id); if (!b || !t) return;
    const s = window.getSelection();
    if (s.rangeCount && !s.isCollapsed && t.contains(s.anchorNode)) s.deleteFromDocument();
    const text = clean(t.textContent);
    if (!text && b.type !== 'p') { b.type = 'p'; delete b.checked; replaceRow(b); focusBlock(id, 'start'); save(); return; }
    const off = caretOffset(t);
    const listType = LIST_TYPES.has(b.type) ? b.type : 'p';
    if (off === 0 && text) {
      const nb = newBlock(listType); if (listType === 'todo') nb.checked = false;
      if (b.indent) nb.indent = b.indent;
      insertBefore(id, nb); b.text = text; focusBlock(id, 'start'); save();
      return;
    }
    b.text = text.slice(0, off); t.textContent = b.text;
    let nType = listType; let nIndent = b.indent || 0; let afterId = id;
    if (b.type === 'toggle') {
      if (b.open !== false) { nType = 'p'; nIndent += 1; }
      else {
        // 접힌 토글: 숨은 내용 다음에 새 토글을 만든다
        nType = 'toggle';
        let j = idx(id) + 1;
        while (j < blocks().length && (blocks()[j].indent || 0) > (b.indent || 0)) j += 1;
        afterId = blocks()[j - 1].id;
      }
    }
    const nb = newBlock(nType, text.slice(off)); if (nType === 'todo') nb.checked = false;
    if (nIndent) nb.indent = Math.min(4, nIndent);
    insertAfter(afterId, nb); focusBlock(nb.id, 'start'); save();
  }

  // 블록 위/아래 이동
  function moveBlock(id, dir) {
    const arr = blocks();
    const i = idx(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    const t = textOf(id);
    const off = t && document.activeElement === t ? caretOffset(t) : 'end';
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const row = rowOf(id); const other = rowOf(arr[i].id);
    if (dir < 0) other.before(row); else other.after(row);
    renumber();
    focusBlock(id, off);
    row.scrollIntoView({ block: 'nearest' });
    save();
  }

  // 핸들 끌기: 놓은 위치로 이동, 움직이지 않고 떼면 블록 메뉴
  function startDrag(e, id) {
    if (readOnly || e.button > 0) return;
    e.preventDefault();
    const startY = e.clientY;
    let dragging = false; let target = null;
    const line = el('div', { class: 'drop-line' });
    const onMove = (ev) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 4) return;
      if (!dragging) { dragging = true; rowOf(id)?.classList.add('dragging'); document.body.append(line); closeSlash(); }
      const rows = [...blocksEl.children];
      let pos = rows.length;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { pos = k; break; }
      }
      target = pos;
      const ref = rows[Math.min(pos, rows.length - 1)].getBoundingClientRect();
      const y = pos < rows.length ? ref.top : ref.bottom;
      const br = blocksEl.getBoundingClientRect();
      line.style.top = `${y - 1}px`; line.style.left = `${br.left}px`; line.style.width = `${br.width}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      line.remove(); rowOf(id)?.classList.remove('dragging');
      if (!dragging) { openBlockMenu(id); return; }
      if (target != null) moveTo(id, target);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
  function moveTo(id, pos) {
    const arr = blocks(); const i = idx(id); if (i < 0) return;
    const to = pos > i ? pos - 1 : pos;
    if (to === i) return;
    const [b] = arr.splice(i, 1); arr.splice(to, 0, b);
    render(); focusBlock(id, 'end'); save();
  }
  async function openBlockMenu(id) {
    const b = find(id); if (!b || readOnly) return;
    const a = await actionSheet(null, [
      { label: '아래에 블록 추가', value: 'add' },
      { label: '형식 바꾸기', value: 'turn' },
      { label: '복제', value: 'dup' },
      { label: '위로 이동', value: 'up' },
      { label: '아래로 이동', value: 'down' },
      { label: '삭제', value: 'del', danger: true },
    ]);
    if (!a || !find(id)) return;
    if (a === 'add') { const nb = insertAfter(id, newBlock()); focusBlock(nb.id, 'start'); save(); }
    else if (a === 'turn') {
      const t = await actionSheet('형식 바꾸기', BLOCK_TYPES.filter((x) => TEXT_TYPES.has(x.type)).map((x) => ({ label: x.label, value: x.type })));
      if (t && find(id)) setType(id, t);
    } else if (a === 'dup') {
      const nb = insertAfter(id, { ...JSON.parse(JSON.stringify(b)), id: newBlock().id });
      focusBlock(nb.id, 'end'); save();
    } else if (a === 'up') moveBlock(id, -1);
    else if (a === 'down') moveBlock(id, 1);
    else if (a === 'del') {
      const i = idx(id); removeBlock(id);
      const p = blocks()[Math.max(0, i - 1)]; if (p) focusBlock(p.id, 'end');
      save();
    }
  }

  // 줄 맨 앞에서 지우기: 형식 해제 → 위 블록과 합치기
  function backspaceAtStart(id) {
    const i = idx(id); const b = blocks()[i]; if (!b) return false;
    if (b.type !== 'p') { b.type = 'p'; delete b.checked; delete b.open; replaceRow(b); focusBlock(id, 0); save(); return true; }
    if (b.indent) { b.indent -= 1; replaceRow(b); focusBlock(id, 0); save(); return true; }
    const prev = blocks()[i - 1]; if (!prev) return false;
    if (!TEXT_TYPES.has(prev.type)) { removeBlock(prev.id); save(); return true; }
    const plen = (prev.text || '').length;
    prev.text = (prev.text || '') + (b.text || '');
    const pt = textOf(prev.id); if (pt) pt.textContent = prev.text;
    removeBlock(id); focusBlock(prev.id, plen); save();
    return true;
  }

  // ---------- 이미지 ----------
  async function insertImageFile(afterId, file) {
    const target = note;
    try {
      const src = await fileToDataURL(file);
      if (note !== target) return;
      const b = find(afterId);
      let imgId;
      if (b && TEXT_TYPES.has(b.type) && !(b.text || '').trim()) {
        b.type = 'image'; b.src = src; b.text = ''; delete b.checked; replaceRow(b); imgId = b.id;
      } else {
        imgId = insertAfter(afterId, { ...newBlock('image'), src }).id;
      }
      let next = blocks()[idx(imgId) + 1];
      if (!next || !TEXT_TYPES.has(next.type)) next = insertAfter(imgId, newBlock());
      focusBlock(next.id, 'start'); save();
    } catch (e) { console.error(e); toast('이미지를 불러오지 못했습니다'); }
  }
  function pickImage(afterId) {
    const inp = el('input', { type: 'file', accept: 'image/*' });
    inp.addEventListener('change', () => { if (inp.files && inp.files[0]) insertImageFile(afterId, inp.files[0]); });
    inp.click();
  }

  // ---------- 슬래시 메뉴 ----------
  function filterTypes(q) {
    q = q.trim().toLowerCase();
    if (!q) return BLOCK_TYPES;
    return BLOCK_TYPES.filter((x) => x.label.toLowerCase().includes(q) || x.keys.some((k) => k.startsWith(q)));
  }
  function openOrUpdateSlash(b, q) {
    if (slashDismissed === b.id) return;
    const items = filterTypes(q);
    if (!items.length) { closeSlash(); return; }
    if (!slash || slash.blockId !== b.id) {
      closeSlash();
      const menu = el('div', { class: 'slash-menu', role: 'listbox' });
      document.body.append(menu);
      slash = { blockId: b.id, menu, items, index: 0 };
    }
    slash.items = items;
    slash.index = Math.min(slash.index, items.length - 1);
    drawSlash(); positionSlash();
  }
  function drawSlash() {
    const { menu, items, index } = slash;
    menu.textContent = '';
    items.forEach((it, k) => {
      const btn = el('button', { type: 'button', class: 'slash-item' + (k === index ? ' sel' : ''), role: 'option' },
        el('span', { class: 'slash-icon' }, it.icon),
        el('span', { class: 'slash-label' }, it.label, el('small', {}, it.hint)));
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => { slash.index = k; chooseSlash(); });
      menu.append(btn);
    });
    menu.children[index]?.scrollIntoView({ block: 'nearest' });
  }
  function positionSlash() {
    if (!slash) return;
    const row = rowOf(slash.blockId); if (!row) return;
    const r = row.getBoundingClientRect();
    const h = slash.menu.offsetHeight || 300;
    const vv = window.visualViewport;
    const viewH = vv ? vv.height + vv.offsetTop : window.innerHeight;
    let top = r.bottom + 4;
    if (top + h > viewH - 8) top = Math.max(8, r.top - h - 4);
    slash.menu.style.top = `${top}px`;
    slash.menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 248))}px`;
  }
  function closeSlash() { if (slash) { slash.menu.remove(); slash = null; } }
  function chooseSlash() {
    if (!slash) return;
    const { blockId, items, index } = slash;
    const it = items[index];
    closeSlash();
    const b = find(blockId); if (!b) return;
    b.text = '';
    const t = textOf(blockId); if (t) t.textContent = '';
    setType(blockId, it.type);
    save();
  }
  function handleSlashKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); slash.index = (slash.index + 1) % slash.items.length; drawSlash(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); slash.index = (slash.index - 1 + slash.items.length) % slash.items.length; drawSlash(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseSlash(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); slashDismissed = slash.blockId; closeSlash(); return true; }
    return false;
  }

  // ---------- 이벤트 ----------
  function onInput(e) {
    if (readOnly) return;
    const t = e.target.closest && e.target.closest('.text'); if (!t) return;
    const id = t.closest('.block').dataset.id;
    const b = find(id); if (!b) return;
    if (t.textContent === '' && t.firstChild) t.textContent = '';
    const text = clean(t.textContent);
    b.text = text;
    if (!e.isComposing && b.type === 'p' && applyShortcut(b, text)) return;
    if (!text.startsWith('/')) slashDismissed = null;
    if (/^\/[^\s/]{0,12}$/.test(text)) openOrUpdateSlash(b, text.slice(1));
    else if (slash && slash.blockId === id) closeSlash();
    save();
  }

  function onBeforeInput(e) {
    if (readOnly) { e.preventDefault(); return; }
    const t = e.target.closest && e.target.closest('.text'); if (!t) return;
    const id = t.closest('.block').dataset.id;
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
      if (slash) { chooseSlash(); return; }
      splitAt(id);
    } else if (e.inputType === 'deleteContentBackward') {
      if (collapsed() && caretOffset(t) === 0 && backspaceAtStart(id)) e.preventDefault();
    } else if (e.inputType.startsWith('format')) {
      e.preventDefault();
    }
  }

  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (slash && handleSlashKey(e)) return;
    if (readOnly) return;
    const row = e.target.closest && e.target.closest('.block'); if (!row) return;
    const id = row.dataset.id; const i = idx(id); const b = blocks()[i]; if (!b) return;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); moveBlock(id, e.key === 'ArrowUp' ? -1 : 1); return;
    }

    if (!TEXT_TYPES.has(b.type)) {
      if (e.target !== row) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const prev = blocks()[i - 1];
        removeBlock(id);
        focusBlock((prev || blocks()[0]).id, prev ? 'end' : 'start'); save();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (b.type === 'page' && hooks.openPage) { hooks.openPage(b.page_id); return; }
        const nb = insertAfter(id, newBlock()); focusBlock(nb.id, 'start'); save();
      } else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); focusBlock(blocks()[i - 1].id, 'end'); }
      else if (e.key === 'ArrowDown' && i < blocks().length - 1) { e.preventDefault(); focusBlock(blocks()[i + 1].id, 'start'); }
      return;
    }

    const t = row.querySelector('.text');
    const len = t.textContent.length;
    const off = caretOffset(t);
    const coll = collapsed();
    const mod = e.metaKey || e.ctrlKey;

    if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); return; }
    if (e.key === 'Tab') { e.preventDefault(); indentBlock(id, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Enter' && mod && b.type === 'todo') {
      e.preventDefault(); b.checked = !b.checked; replaceRow(b); focusBlock(id, off); save(); return;
    }
    if (e.key === 'Backspace' && coll && off === 0) { if (backspaceAtStart(id)) e.preventDefault(); return; }
    if (e.key === 'Delete' && coll && off === len) {
      const next = blocks()[i + 1]; if (!next) return;
      e.preventDefault();
      if (!TEXT_TYPES.has(next.type)) { removeBlock(next.id); save(); return; }
      b.text = clean(t.textContent) + (next.text || ''); t.textContent = b.text;
      removeBlock(next.id); focusBlock(id, len); save();
      return;
    }
    if (e.key === 'ArrowUp' && coll && off === 0 && i > 0) { e.preventDefault(); focusBlock(blocks()[i - 1].id, 'end'); return; }
    if (e.key === 'ArrowDown' && coll && off === len && i < blocks().length - 1) { e.preventDefault(); focusBlock(blocks()[i + 1].id, 'start'); }
  }

  function onPaste(e) {
    if (readOnly) return;
    const t = e.target.closest && e.target.closest('.text'); if (!t) return;
    const id = t.closest('.block').dataset.id;
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const img = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    e.preventDefault();
    if (img) { insertImageFile(id, img.getAsFile()); return; }
    const text = clean((e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n'));
    if (!text) return;
    const lines = text.split('\n');
    if (lines.length === 1) {
      if (!document.execCommand('insertText', false, text)) {
        const off = caretOffset(t); const cur = t.textContent;
        t.textContent = cur.slice(0, off) + text + cur.slice(off);
        setCaret(t, off + text.length);
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    const b = find(id);
    const cur = clean(t.textContent); const off = caretOffset(t);
    const after = cur.slice(off);
    b.text = cur.slice(0, off) + lines[0]; t.textContent = b.text;
    let lastId = id;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      let nb = null;
      const num = line.match(/^\d+[.)]\s/);
      if (num) nb = newBlock('number', line.slice(num[0].length));
      if (!nb) for (const [re, type] of SHORTCUTS) {
        const m = line.match(re);
        if (m) { nb = newBlock(type, line.slice(m[0].length)); if (type === 'todo') nb.checked = /x/i.test(m[0]); break; }
      }
      if (!nb) nb = newBlock(line.startsWith('### ') || line.startsWith('## ') ? 'h2' : 'p', line.replace(/^#{2,3}\s/, ''));
      lastId = insertAfter(lastId, nb).id;
    }
    const last = find(lastId);
    const endLen = (last.text || '').length;
    last.text = (last.text || '') + after;
    textOf(lastId).textContent = last.text;
    focusBlock(lastId, endLen); save();
  }

  blocksEl.addEventListener('input', onInput);
  blocksEl.addEventListener('compositionend', onInput);
  blocksEl.addEventListener('beforeinput', onBeforeInput);
  blocksEl.addEventListener('keydown', onKeyDown);
  blocksEl.addEventListener('paste', onPaste);
  blocksEl.addEventListener('drop', (e) => {
    const f = [...((e.dataTransfer && e.dataTransfer.files) || [])].find((x) => x.type.startsWith('image/'));
    const row = e.target.closest && e.target.closest('.block');
    if (f && row && !readOnly) { e.preventDefault(); insertImageFile(row.dataset.id, f); }
  });
  blocksEl.addEventListener('focusin', (e) => {
    const row = e.target.closest('.block');
    if (row) { activeId = row.dataset.id; updateToolbar(); }
  });
  blocksEl.addEventListener('focusout', () => {
    setTimeout(() => {
      if (slash && !rowOf(slash.blockId)?.contains(document.activeElement)) closeSlash();
    }, 120);
  });
  blocksEl.closest('.editor-wrap')?.addEventListener('scroll', () => positionSlash(), { passive: true });

  titleEl.addEventListener('input', () => { if (!note || readOnly) return; note.title = titleEl.value; save(); });
  titleEl.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const first = blocks()[0]; if (first) focusBlock(first.id, 'start');
    }
  });

  // ---------- 도구 막대 ----------
  function buildToolbar() {
    toolbarEl.textContent = '';
    const keep = (btn) => {
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      return btn;
    };
    for (const [type, label] of TOOLBAR) {
      toolbarEl.append(keep(el('button', {
        type: 'button', 'data-type': type,
        onclick: () => {
          if (!note || readOnly) return;
          const target = activeId && idx(activeId) >= 0 ? activeId : blocks()[blocks().length - 1]?.id;
          if (target) setType(target, type, true);
        },
      }, label)));
    }
    for (const [dir, label, aria] of [[-1, '⇤', '내어쓰기'], [1, '⇥', '들여쓰기']]) {
      toolbarEl.append(keep(el('button', {
        type: 'button', class: 'tb-move', 'aria-label': aria, title: aria,
        onclick: () => { if (note && !readOnly && activeId && idx(activeId) >= 0) indentBlock(activeId, dir); },
      }, label)));
    }
    for (const [dir, label, aria] of [[-1, '↑', '위로 이동'], [1, '↓', '아래로 이동']]) {
      toolbarEl.append(keep(el('button', {
        type: 'button', class: 'tb-move', 'aria-label': aria, title: aria,
        onclick: () => { if (note && !readOnly && activeId && idx(activeId) >= 0) moveBlock(activeId, dir); },
      }, label)));
    }
    toolbarEl.append(keep(el('button', {
      type: 'button', class: 'tb-move', 'aria-label': '블록 메뉴', title: '블록 메뉴',
      onclick: () => { if (note && !readOnly && activeId && idx(activeId) >= 0) openBlockMenu(activeId); },
    }, '⋯')));
    toolbarEl.append(el('span', { class: 'tb-spacer' }),
      keep(el('button', { type: 'button', class: 'tb-done', onclick: () => document.activeElement && document.activeElement.blur() }, '완료')));
  }
  function updateToolbar() {
    const b = activeId ? find(activeId) : null;
    toolbarEl.querySelectorAll('[data-type]').forEach((btn) => {
      btn.classList.toggle('on', !!b && b.type !== 'p' && b.type === btn.dataset.type);
    });
  }
  buildToolbar();

  // ---------- 외부 API ----------
  return {
    open(n, opts = {}) {
      note = n; readOnly = !!opts.readOnly; activeId = null; closeSlash();
      if (!Array.isArray(note.blocks) || !note.blocks.length) note.blocks = [newBlock()];
      titleEl.value = note.title || '';
      titleEl.readOnly = readOnly;
      render(); updateToolbar();
    },
    close() { note = null; activeId = null; closeSlash(); blocksEl.textContent = ''; titleEl.value = ''; },
    currentId: () => (note ? note.id : null),
    refreshPageLinks() {
      if (!note) return;
      blocksEl.querySelectorAll('.block-page').forEach((row) => {
        const b = find(row.dataset.id); if (!b) return;
        const p = hooks.getPage ? hooks.getPage(b.page_id) : null;
        const ico = row.querySelector('.page-link-ico'); const ttl = row.querySelector('.page-link-title');
        if (ico) ico.textContent = (p && p.icon) || '📄';
        if (ttl) ttl.textContent = pageTitle(p);
      });
    },
    isFocused() {
      const a = document.activeElement;
      return !!note && (a === titleEl || blocksEl.contains(a));
    },
    refreshIfIdle() {
      if (!note) return;
      const a = document.activeElement;
      if (a === titleEl || blocksEl.contains(a)) return;
      if (!Array.isArray(note.blocks) || !note.blocks.length) note.blocks = [newBlock()];
      titleEl.value = note.title || '';
      render();
    },
    focusEnd() {
      if (!note || readOnly) return;
      const last = blocks()[blocks().length - 1];
      if (last && TEXT_TYPES.has(last.type)) focusBlock(last.id, 'end');
      else { const nb = newBlock(); blocks().push(nb); blocksEl.append(renderBlock(nb)); focusBlock(nb.id, 'start'); save(); }
    },
  };
}
