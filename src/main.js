// 앱 화면: 왼쪽 사이드바(섹션 → 페이지 → 하위 페이지 나무) + 오른쪽 페이지
// 휴대폰에서는 사이드바 화면과 페이지 화면을 오간다
import * as store from './store.js';
import * as sync from './sync.js';
import { createEditor } from './editor.js';
import { el, icon, actionSheet, openOverlay, toast, formatFull, download, confirmDialog, alertDialog, promptDialog } from './ui.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const UI_KEY = 'memo.ui.v2';
const JOIN_KEY = 'memo.pendingJoin';

const COVERS = {
  sand: 'linear-gradient(120deg, #f7d488 0%, #f0a46a 100%)',
  sea: 'linear-gradient(120deg, #a6d8ea 0%, #5b8fd6 100%)',
  forest: 'linear-gradient(120deg, #c2e3b4 0%, #4f8f68 100%)',
  dusk: 'linear-gradient(120deg, #cbb8f2 0%, #e89cb6 100%)',
  paper: 'linear-gradient(120deg, #f2efe7 0%, #d8d1bf 100%)',
  ink: 'linear-gradient(120deg, #56606f 0%, #1f2630 100%)',
};
const EMOJIS = ['📄', '📝', '📌', '📚', '💡', '✅', '🗂️', '📅', '🎯', '🚀', '⭐', '❤️', '🔥', '🌱', '🌙', '☀️',
  '🏕️', '🎮', '🎨', '🎬', '🎵', '📷', '✈️', '🏠', '💼', '💰', '📈', '🧠', '🛒', '🍳', '☕', '🍺',
  '🐶', '🐱', '⚽', '🏃', '🧘', '💬', '🔒', '🔧', '🧪', '📦', '🗺️', '🎁', '🧩', '🪴', '🌊', '👋'];

// 빈 페이지에서 고르는 템플릿
const B = (type, text = '', extra = {}) => ({ ...store.newBlock(type, text), ...extra });
const TEMPLATES = [
  { icon: '✅', name: '할 일 목록', blocks: () => [B('todo', '', { checked: false }), B('todo', '', { checked: false }), B('todo', '', { checked: false })] },
  { icon: '🗓️', name: '회의록', blocks: () => [
    B('callout', `${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}`, { icon: '📅' }),
    B('h2', '참석자'), B('bullet'), B('h2', '안건'), B('number'), B('h2', '결정 사항'), B('bullet'), B('h2', '할 일'), B('todo', '', { checked: false })] },
  { icon: '📔', name: '일기', title: () => `${new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} 일기`, blocks: () => [
    B('callout', '오늘 기분 한 줄', { icon: '🌤️' }), B('h2', '오늘 한 일'), B('bullet'), B('h2', '좋았던 것'), B('bullet'), B('h2', '내일 할 일'), B('todo', '', { checked: false })] },
  { icon: '🧩', name: '기획서', blocks: () => [
    B('callout', '한 문장으로 요약', { icon: '🎯' }), B('h2', '배경'), B('p'), B('h2', '목표'), B('bullet'), B('h2', '세부 내용'),
    B('toggle', '아이디어 메모'), B('p', '', { indent: 1 }), B('h2', '일정'),
    B('table', '', { rows: [['단계', '기간', '담당'], ['', '', ''], ['', '', '']] }), B('h2', '할 일'), B('todo', '', { checked: false })] },
  { icon: '📚', name: '독서 기록', blocks: () => [
    B('table', '', { rows: [['제목', '저자', '평점', '다 읽은 날'], ['', '', '', '']] }), B('h2', '인상 깊은 문장'), B('quote'), B('h2', '생각'), B('p')] },
];

function readUI() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; }
}
const saved = readUI();
const ui = { pageId: saved.pageId || null, view: saved.view === 'page' ? 'page' : 'tree', recent: Array.isArray(saved.recent) ? saved.recent : [] };
const expanded = new Set(saved.expanded || []);
const collapsedSections = new Set(saved.collapsed || []);
let query = '';
let settingsRedraw = null;

const isMobile = () => window.matchMedia('(max-width: 759px)').matches;
function saveUI() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ pageId: ui.pageId, view: ui.view, recent: ui.recent, expanded: [...expanded], collapsed: [...collapsedSections] }));
  } catch { /* 저장 불가 환경 */ }
}
function setView(v) { ui.view = v; app.dataset.view = v; saveUI(); }

const editor = createEditor({
  blocksEl: $('#blocks'),
  titleEl: $('#note-title'),
  toolbarEl: $('#toolbar'),
  onChange: (n) => store.updateNote(n.id, { title: n.title, blocks: n.blocks }, 'content'),
  hooks: {
    getPage: (id) => store.getNote(id),
    openPage: (id, opts) => openPage(id, opts),
    createSubpage: (parentId) => {
      const p = store.getNote(parentId);
      expanded.add(parentId);
      return store.createNote(p.folder_id, parentId);
    },
    pickEmoji: (cb) => emojiPicker(cb, false),
  },
});
store.setLock(() => (editor.isFocused() ? editor.currentId() : null));

// ---------- 사이드바 ----------
function caretIcon() {
  const s = el('span', { class: 'caret-ico' });
  s.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6.5l7 5.5-7 5.5z"/></svg>';
  return s;
}
const pageIco = (n) => (n.icon ? el('span', { class: 'pg-ico' }, n.icon) : icon('notes'));
const titleOf = (n) => (n.title || '').trim() || '제목 없음';

function pageRows(n, depth) {
  const open = expanded.has(n.id);
  const kids = open ? store.childPages(n.id) : [];
  const row = el('div', { class: 'tree-row' + (n.id === ui.pageId ? ' active' : ''), style: `--depth:${depth}` },
    el('button', {
      class: 'caret' + (open ? ' open' : ''), type: 'button', 'aria-label': open ? '접기' : '펼치기',
      onclick: () => { if (open) expanded.delete(n.id); else expanded.add(n.id); saveUI(); renderTree(); },
    }, caretIcon()),
    el('button', { class: 'tree-label', type: 'button', onclick: () => openPage(n.id) }, pageIco(n), el('span', { class: 'tree-title' }, titleOf(n))),
    el('span', { class: 'tree-actions' },
      el('button', { class: 'mini', type: 'button', 'aria-label': '페이지 메뉴', title: '메뉴', onclick: () => pageMenu(n.id) }, '⋯'),
      el('button', { class: 'mini', type: 'button', 'aria-label': '하위 페이지 추가', title: '하위 페이지 추가', onclick: () => newPage(n.folder_id, n.id) }, '+')));
  const out = [row];
  if (open) {
    if (kids.length) for (const k of kids) out.push(...pageRows(k, depth + 1));
    else out.push(el('div', { class: 'tree-empty', style: `--depth:${depth + 1}` }, '하위 페이지 없음'));
  }
  return out;
}

function renderTree() {
  const tree = $('#tree');
  const scroll = tree.scrollTop;
  tree.textContent = '';
  if (query.trim()) {
    const res = store.listNotes('all', query);
    tree.append(el('div', { class: 'section-label' }, `검색 결과 ${res.length}개`));
    for (const n of res) {
      const path = [store.getFolder(n.folder_id)?.name, ...store.ancestors(n.id).map(titleOf)].filter(Boolean).join(' / ');
      tree.append(el('button', { class: 'result-row' + (n.id === ui.pageId ? ' active' : ''), type: 'button', onclick: () => openPage(n.id) },
        pageIco(n), el('span', { class: 'result-text' }, el('span', { class: 'tree-title' }, titleOf(n)), el('small', {}, path))));
    }
    if (!res.length) tree.append(el('div', { class: 'tree-empty', style: '--depth:0' }, '결과가 없습니다'));
    return;
  }
  const recent = ui.recent.map((id) => store.getNote(id)).filter((n) => n && !n.deleted).slice(0, 5);
  if (recent.length) {
    tree.append(el('div', { class: 'section-head static mobile-only' }, el('span', { class: 'section-name' }, '최근')));
    for (const n of recent) {
      tree.append(el('button', { class: 'result-row mobile-only', type: 'button', onclick: () => openPage(n.id) },
        pageIco(n), el('span', { class: 'result-text' }, el('span', { class: 'tree-title' }, titleOf(n)),
          el('small', {}, [store.getFolder(n.folder_id)?.name, ...store.ancestors(n.id).map(titleOf)].filter(Boolean).join(' / ')))));
    }
  }
  const favs = store.favorites();
  if (favs.length) {
    tree.append(el('div', { class: 'section-head static' }, el('span', { class: 'section-name' }, '즐겨찾기')));
    for (const n of favs) tree.append(...pageRows(n, 0));
  }
  for (const f of store.listFolders()) {
    const closed = collapsedSections.has(f.id);
    tree.append(el('div', { class: 'section-head' },
      el('button', {
        class: 'section-name', type: 'button', 'aria-expanded': String(!closed),
        onclick: () => { if (closed) collapsedSections.delete(f.id); else collapsedSections.add(f.id); saveUI(); renderTree(); },
      }, f.name, f.shared || f.linked ? el('span', { class: 'shared-tag' }, '공유') : null),
      el('span', { class: 'tree-actions' },
        el('button', { class: 'mini', type: 'button', 'aria-label': '섹션 메뉴', title: '섹션 메뉴', onclick: () => folderMenu(f.id) }, '⋯'),
        el('button', { class: 'mini', type: 'button', 'aria-label': '페이지 추가', title: '페이지 추가', onclick: () => newPage(f.id, null) }, '+'))));
    if (closed) continue;
    const tops = store.topPages(f.id);
    for (const n of tops) tree.append(...pageRows(n, 0));
    if (!tops.length) tree.append(el('button', { class: 'tree-add', type: 'button', onclick: () => newPage(f.id, null) }, '+ 페이지 추가'));
  }
  tree.scrollTop = scroll;
}

// ---------- 페이지 머리말 ----------
function renderHeader() {
  const n = ui.pageId && store.getNote(ui.pageId);
  const crumbs = $('#crumbs');
  crumbs.textContent = '';
  if (!n) return;
  const f = store.getFolder(n.folder_id);
  const parts = [];
  if (f) parts.push(el('span', { class: 'crumb muted' }, f.name));
  for (const a of store.ancestors(n.id)) {
    parts.push(el('button', { class: 'crumb', type: 'button', onclick: () => openPage(a.id) }, a.icon ? `${a.icon} ` : '', titleOf(a)));
  }
  parts.push(el('span', { class: 'crumb current' }, n.icon ? `${n.icon} ` : '', titleOf(n)));
  parts.forEach((p, i) => { if (i) crumbs.append(el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/')); crumbs.append(p); });

  const ico = $('#page-icon');
  ico.hidden = !n.icon; ico.textContent = n.icon || '';
  const cover = $('#cover');
  cover.hidden = !n.cover || !COVERS[n.cover];
  cover.style.background = COVERS[n.cover] || '';
  cover.classList.toggle('readonly', !!n.deleted);
  $('#btn-add-icon').hidden = !!n.icon || !!n.deleted;
  $('#btn-add-cover').hidden = !!n.cover || !!n.deleted;
  $('#editor').classList.toggle('has-icon', !!n.icon);
  const chars = store.noteText(n).replace(/\s/g, '').length;
  renderTemplates(n);
  $('#note-meta').textContent = [`수정 ${formatFull(n.updated_at)}`, f?.shared ? '공유 섹션' : null, `${chars.toLocaleString('ko-KR')}자`].filter(Boolean).join(' · ');
}

function renderTemplates(n) {
  const box = $('#templates');
  const blocks = (n && n.blocks) || [];
  const blank = n && !n.deleted && blocks.length <= 1 && (!blocks[0] || (blocks[0].type === 'p' && !(blocks[0].text || '').trim()));
  box.hidden = !blank;
  if (!blank || box.dataset.for === n.id) return;
  box.dataset.for = n.id;
  box.textContent = '';
  box.append(el('div', { class: 'templates-label' }, '빈 페이지로 시작하거나 템플릿을 고르세요'));
  for (const t of TEMPLATES) {
    box.append(el('button', {
      type: 'button', class: 'tpl-btn',
      onclick: () => {
        const cur = store.getNote(n.id); if (!cur) return;
        const patch = { blocks: t.blocks() };
        if (!cur.icon) patch.icon = t.icon;
        if (!(cur.title || '').trim() && t.title) patch.title = t.title();
        store.updateNote(n.id, patch);
        editor.open(store.getNote(n.id));
        renderHeader();
        editor.focusFirst();
      },
    }, el('span', { class: 'tpl-ico' }, t.icon), t.name));
  }
}

function showEditor(n) {
  const on = !!n;
  $('#editor').hidden = !on;
  $('#empty-editor').hidden = on;
  $('#btn-note-menu').hidden = !on;
  $('#toolbar').hidden = !on || !!n.deleted;
  $('#trash-banner').hidden = !(n && n.deleted);
  if (!on) { $('#cover').hidden = true; $('#crumbs').textContent = ''; $('#templates').hidden = true; }
}

function renderAll() {
  if (ui.pageId && !store.getNote(ui.pageId)) {
    ui.pageId = null; editor.close(); showEditor(null);
    if (ui.view === 'page') setView('tree');
  }
  renderTree(); renderHeader(); editor.refreshPageLinks();
  saveUI();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

store.subscribe((kind, ids) => {
  if (kind === 'save-error') { toast('기기 저장 공간이 부족합니다. 큰 이미지를 지우거나 동기화를 켜세요.'); return; }
  if (kind === 'remote') {
    if (ui.pageId && ids && ids.includes(ui.pageId)) {
      const n = store.getNote(ui.pageId);
      if (n) { editor.refreshIfIdle(); showEditor(n); }
    }
  } else if (kind !== 'local') {
    sync.scheduleSync();
  }
  scheduleRender();
});

// ---------- 페이지 열기/만들기 ----------
// 아무것도 안 쓰고 나간 새 페이지는 지우고, 부모 페이지의 링크 블록도 함께 없앤다
function cleanupEmpty(nextId) {
  const cur = ui.pageId && store.getNote(ui.pageId);
  if (!cur || cur.id === nextId || cur.deleted || !store.isEmptyNote(cur)) return;
  const parent = cur.parent_id && store.getNote(cur.parent_id);
  if (parent && (parent.blocks || []).some((b) => b.page_id === cur.id)) {
    store.updateNote(parent.id, { blocks: parent.blocks.filter((b) => b.page_id !== cur.id) });
  }
  store.purgeNote(cur.id);
}

function openPage(id, { focus, keepView } = {}) {
  cleanupEmpty(id);
  const n = store.getNote(id); if (!n) return;
  ui.pageId = id;
  ui.recent = [id, ...ui.recent.filter((x) => x !== id)].slice(0, 8);
  query = ''; $('#search').value = '';
  store.ancestors(id).forEach((a) => expanded.add(a.id));
  if (store.childPages(id).length) expanded.add(id);
  collapsedSections.delete(n.folder_id);
  editor.open(n, { readOnly: n.deleted });
  showEditor(n);
  if (!keepView) setView('page');
  renderTree(); renderHeader();
  $('#editor-wrap').scrollTop = 0;
  saveUI();
  if (focus === 'title') $('#note-title').focus();
}

function goBack() {
  const cur = ui.pageId && store.getNote(ui.pageId);
  const parent = cur && !cur.deleted && store.ancestors(cur.id).pop();
  if (parent) { openPage(parent.id); return; }
  cleanupEmpty(null);
  ui.pageId = null; editor.close(); showEditor(null);
  setView('tree'); renderAll();
}

function currentFolderId() {
  const n = ui.pageId && store.getNote(ui.pageId);
  const f = n && store.getFolder(n.folder_id);
  return f && !f.deleted ? f.id : store.ensureDefaultFolder().id;
}

function newPage(folderId, parentId = null) {
  let fid = folderId;
  const f = store.getFolder(fid);
  if (!f || f.deleted) fid = store.ensureDefaultFolder().id;
  const n = store.createNote(fid, parentId);
  if (parentId) {
    expanded.add(parentId);
    const p = store.getNote(parentId);
    if (p) store.updateNote(p.id, { blocks: [...(p.blocks || []), { ...store.newBlock('page'), page_id: n.id }] });
  }
  openPage(n.id, { focus: 'title' });
}

async function newFolder() {
  const name = await promptDialog('새 섹션', '', { ok: '만들기', placeholder: '예: 회사, 게임 기획, 여행' });
  if (!name || !name.trim()) return;
  const f = store.createFolder(name.trim());
  collapsedSections.delete(f.id);
  renderAll();
  toast(`'${f.name}' 섹션을 만들었습니다`);
}

// ---------- 메뉴 ----------
async function folderMenu(fid) {
  const f = store.getFolder(fid); if (!f) return;
  const acts = [{ label: '새 페이지', value: 'new' }, { label: '이름 변경', value: 'rename' }, { label: '공유 링크 만들기', value: 'share' }];
  if (f.shared) acts.push({ label: '공유 섹션 나가기', value: 'leave', danger: true });
  else acts.push({ label: '섹션 삭제', value: 'delete', danger: true });
  const a = await actionSheet(f.name, acts);
  if (a === 'new') newPage(f.id, null);
  else if (a === 'rename') {
    const name = await promptDialog('섹션 이름 변경', f.name, { ok: '저장' });
    if (name && name.trim()) store.renameFolder(f.id, name.trim());
  } else if (a === 'share') shareFolder(f);
  else if (a === 'leave') {
    if (await confirmDialog(`'${f.name}' 공유 섹션에서 나갈까요? 내 기기와 계정에서 더 이상 보이지 않습니다.`, { ok: '나가기', danger: true })) {
      try { await sync.leaveFolder(f.id); renderAll(); toast('공유 섹션에서 나갔습니다'); }
      catch (e) { alertDialog(`나가지 못했습니다.\n${e.message || e}`); }
    }
  } else if (a === 'delete') {
    if (await confirmDialog(`'${f.name}' 섹션을 삭제할까요? 안의 페이지는 휴지통으로 이동합니다.`, { ok: '삭제', danger: true })) {
      store.deleteFolder(f.id); renderAll();
    }
  }
}

async function pageMenu(id) {
  const n = store.getNote(id); if (!n) return;
  if (n.deleted) { trashItemMenu(n); return; }
  const a = await actionSheet(titleOf(n), [
    { label: n.pinned ? '즐겨찾기에서 빼기' : '즐겨찾기에 추가', value: 'pin' },
    { label: '하위 페이지 추가', value: 'sub' },
    { label: n.icon ? '아이콘 바꾸기' : '아이콘 추가', value: 'icon' },
    { label: n.cover ? '커버 바꾸기' : '커버 추가', value: 'cover' },
    { label: '위로 이동', value: 'up' },
    { label: '아래로 이동', value: 'down' },
    { label: '다른 페이지 안으로 이동', value: 'nest' },
    { label: '다른 섹션으로 이동', value: 'move' },
    { label: '복제', value: 'dup' },
    { label: '텍스트로 내보내기', value: 'export' },
    { label: '휴지통으로 이동', value: 'delete', danger: true },
  ]);
  if (a === 'pin') store.updateNote(n.id, { pinned: !n.pinned });
  else if (a === 'sub') newPage(n.folder_id, n.id);
  else if (a === 'icon') emojiPicker((e) => store.updateNote(n.id, { icon: e }), !!n.icon);
  else if (a === 'cover') coverPicker(n.id);
  else if (a === 'up' || a === 'down') { if (!store.reorderSibling(n.id, a === 'up' ? -1 : 1)) toast(a === 'up' ? '이미 맨 위입니다' : '이미 맨 아래입니다'); }
  else if (a === 'nest') {
    const banned = new Set([n.id]);
    for (const p of store.allPages()) if (store.ancestors(p.id).some((x) => x.id === n.id)) banned.add(p.id);
    const cands = store.allPages().filter((p) => !banned.has(p.id) && p.id !== n.parent_id).slice(0, 40);
    if (!cands.length) { toast('옮길 수 있는 페이지가 없습니다'); return; }
    const to = await actionSheet('어느 페이지 안으로 옮길까요?', cands.map((p) => ({
      label: `${p.icon || '📄'}  ${[...store.ancestors(p.id).map(titleOf), titleOf(p)].join(' / ')}`, value: p.id,
    })));
    if (to && store.moveUnder(n.id, to)) { expanded.add(to); toast('옮겼습니다'); }
  }
  else if (a === 'move') {
    const fs = store.listFolders();
    const to = await actionSheet('이동할 섹션 (맨 위 단계로 이동)', fs.map((f) => ({ label: f.id === n.folder_id ? `${f.name} (현재)` : f.name, value: f.id })));
    if (to) { store.moveNote(n.id, to); toast('이동했습니다'); }
  } else if (a === 'dup') {
    const c = store.duplicateNote(n.id);
    if (c) { openPage(c.id); toast('복제했습니다'); }
  } else if (a === 'export') {
    const md = store.toMarkdown(n);
    if (navigator.share && isMobile()) { try { await navigator.share({ title: titleOf(n), text: md }); } catch { /* 취소 */ } }
    else download(`${titleOf(n).replace(/[\\/:*?"<>|]/g, '_')}.md`, md, 'text/markdown');
  } else if (a === 'delete') {
    const kids = store.childPages(n.id).length;
    store.trashNote(n.id);
    const cur = ui.pageId && store.getNote(ui.pageId);
    if (cur && cur.deleted) goBack();
    toast(kids ? '하위 페이지와 함께 휴지통으로 이동했습니다' : '휴지통으로 이동했습니다');
  }
}

async function trashItemMenu(n) {
  const a = await actionSheet(titleOf(n), [
    { label: '복구', value: 'restore' }, { label: '열어보기', value: 'open' }, { label: '영구 삭제', value: 'purge', danger: true },
  ]);
  if (a === 'restore') { store.restoreNote(n.id); openPage(n.id); toast('복구했습니다'); }
  else if (a === 'open') openPage(n.id);
  else if (a === 'purge' && await confirmDialog('이 페이지를 영구 삭제할까요? 되돌릴 수 없습니다.', { ok: '영구 삭제', danger: true })) {
    store.purgeNote(n.id);
    if (ui.pageId === n.id) goBack();
  }
}

async function openTrash() {
  const items = store.listNotes('trash').filter((n) => !n.parent_id || !store.getNote(n.parent_id)?.deleted);
  if (!items.length) { toast('휴지통이 비어 있습니다'); return; }
  const a = await actionSheet(`휴지통 (${items.length})`, [
    ...items.slice(0, 40).map((n) => ({ label: `${n.icon || '📄'}  ${titleOf(n)}`, value: n.id })),
    { label: '휴지통 비우기', value: '__empty', danger: true },
  ]);
  if (!a) return;
  if (a === '__empty') {
    if (await confirmDialog('휴지통의 페이지를 모두 영구 삭제할까요? 되돌릴 수 없습니다.', { ok: '모두 삭제', danger: true })) {
      const c = store.emptyTrash(); toast(`${c}개를 영구 삭제했습니다`);
    }
    return;
  }
  const n = store.getNote(a); if (n) trashItemMenu(n);
}

function emojiPicker(onPick, allowRemove = true) {
  let close = () => {};
  const grid = el('div', { class: 'emoji-grid' },
    EMOJIS.map((e) => el('button', { type: 'button', class: 'emoji-btn', onclick: () => { onPick(e); close(); } }, e)));
  const box = el('div', {}, el('h4', {}, '아이콘'), grid,
    allowRemove ? el('button', { class: 'sheet-btn danger', type: 'button', onclick: () => { onPick(''); close(); } }, '아이콘 제거') : null);
  close = openOverlay(box);
}

function coverPicker(id) {
  let close = () => {};
  const n = store.getNote(id);
  const grid = el('div', { class: 'cover-grid' },
    Object.entries(COVERS).map(([k, bg]) => el('button', {
      type: 'button', class: 'cover-swatch' + (n && n.cover === k ? ' on' : ''), style: `background:${bg}`, 'aria-label': k,
      onclick: () => { store.updateNote(id, { cover: k }); close(); },
    })));
  const box = el('div', {}, el('h4', {}, '커버'), grid,
    n && n.cover ? el('button', { class: 'sheet-btn danger', type: 'button', onclick: () => { store.updateNote(id, { cover: '' }); close(); } }, '커버 제거') : null);
  close = openOverlay(box);
}

async function shareFolder(f) {
  if (!sync.enabled()) { await alertDialog('섹션 공유는 동기화(Supabase)를 연결해야 쓸 수 있습니다. 설정 화면의 안내를 확인하세요.'); openSettings(); return; }
  if (!sync.user()) { toast('먼저 로그인하세요'); openSettings(); return; }
  let url = '';
  try {
    toast('공유 링크를 만드는 중…');
    url = await sync.createShareLink(f.id);
    store.setLocal('folders', f.id, { linked: true });
    if (navigator.share) {
      try { await navigator.share({ title: f.name, text: `'${f.name}' 섹션을 함께 써요`, url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    await navigator.clipboard.writeText(url);
    toast('공유 링크를 복사했습니다');
  } catch (e) {
    console.error(e);
    if (url) await promptDialog('아래 링크를 복사해 보내세요', url, { ok: '닫기' });
    else await alertDialog(`공유 링크를 만들지 못했습니다.\n${e.message || e}`);
  }
}

// ---------- 설정 ----------
function openSettings() {
  const box = el('div', {});
  const draw = () => {
    box.textContent = '';
    box.append(el('h4', {}, '동기화'));
    if (!sync.enabled()) {
      box.append(el('p', { class: 'note-text' }, '지금은 이 기기에만 저장됩니다. 동기화를 연결하면 로그인 후 컴퓨터와 아이폰이 같은 페이지를 보고, 섹션 공유도 켜집니다.'));
    } else if (!sync.user()) {
      const email = el('input', { type: 'email', id: 'login-email', placeholder: '이메일', autocomplete: 'email', inputmode: 'email' });
      const pw = el('input', { type: 'password', id: 'login-pw', placeholder: '비밀번호 (6자 이상)', autocomplete: 'current-password' });
      const msg = el('p', { class: 'note-text' });
      const run = async (fn) => {
        msg.textContent = '처리 중…';
        try { msg.textContent = (await fn(email.value.trim(), pw.value)) || ''; }
        catch (e) { msg.textContent = e.message || String(e); }
      };
      box.append(el('div', { class: 'form' }, email, pw,
        el('div', { class: 'row' },
          el('button', { class: 'btn primary', type: 'button', onclick: () => run(sync.signIn) }, '로그인'),
          el('button', { class: 'btn', type: 'button', onclick: () => run(sync.signUp) }, '처음이면 가입'))), msg);
    } else {
      box.append(el('p', { class: 'note-text' }, `${sync.user().email} 계정으로 동기화 중입니다.`),
        el('div', { class: 'form' }, el('div', { class: 'row' },
          el('button', { class: 'btn primary', type: 'button', onclick: async () => { await sync.syncNow(); toast('동기화했습니다'); } }, '지금 동기화'),
          el('button', { class: 'btn', type: 'button', onclick: async () => { await sync.signOut(); draw(); } }, '로그아웃'))));
    }
    box.append(el('h4', {}, '데이터'),
      el('div', { class: 'form' }, el('div', { class: 'row' },
        el('button', { class: 'btn', type: 'button', onclick: exportAll }, '전체 백업 내보내기'),
        el('button', { class: 'btn', type: 'button', onclick: importAll }, '백업 가져오기'))));
  };
  draw();
  settingsRedraw = draw;
  openOverlay(box, { onClose: () => { settingsRedraw = null; } });
}

function exportAll() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  download(`memo-backup-${stamp}.json`, store.exportData());
}
function importAll() {
  const inp = el('input', { type: 'file', accept: 'application/json,.json' });
  inp.addEventListener('change', async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    try { const c = store.importData(JSON.parse(await file.text())); toast(`페이지 ${c}개를 가져왔습니다`); }
    catch (e) { alertDialog(`가져오지 못했습니다.\n${e.message || e}`); }
  });
  inp.click();
}

// ---------- 동기화 상태 / 공유 참여 ----------
function onStatus(s, d) {
  const labels = { local: '이 기기에 저장', 'signed-out': '로그인 필요', syncing: '동기화 중…', offline: '오프라인', error: '동기화 오류' };
  const node = $('#sync-status');
  node.dataset.state = s;
  node.textContent = s === 'synced' ? `동기화됨 ${d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}` : (labels[s] || '');
  node.title = s === 'error' ? String(d || '') : '';
}

async function handleJoin(token) {
  try {
    const fid = await sync.joinShare(token);
    sessionStorage.removeItem(JOIN_KEY);
    await sync.syncNow();
    collapsedSections.delete(fid);
    setView('tree'); renderAll();
    toast('공유 섹션에 참여했습니다');
  } catch (e) {
    sessionStorage.removeItem(JOIN_KEY);
    alertDialog(`공유 링크를 열 수 없습니다.\n${e.message || e}`);
  }
}

function onUser(u) {
  if (settingsRedraw) settingsRedraw();
  const token = sessionStorage.getItem(JOIN_KEY);
  if (u && token) handleJoin(token);
}

function captureJoinParam() {
  const params = new URLSearchParams(location.search);
  const token = params.get('join');
  if (!token) return;
  sessionStorage.setItem(JOIN_KEY, token);
  params.delete('join');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  if (!sync.enabled()) { alertDialog('이 앱에 동기화가 설정되지 않아 공유 링크를 열 수 없습니다.'); sessionStorage.removeItem(JOIN_KEY); return; }
  setTimeout(() => { if (!sync.user()) { toast('공유 섹션에 참여하려면 로그인하세요'); openSettings(); } }, 1200);
}

// ---------- 시작 ----------
function bind() {
  $('#btn-new-page').addEventListener('click', () => newPage(currentFolderId(), null));
  $('#btn-new-folder').addEventListener('click', newFolder);
  $('#btn-trash').addEventListener('click', openTrash);
  $('#btn-note-menu').addEventListener('click', () => { if (ui.pageId) pageMenu(ui.pageId); });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#sync-status').addEventListener('click', openSettings);
  $('#btn-back').addEventListener('click', goBack);
  $('#btn-restore').addEventListener('click', () => {
    if (!ui.pageId) return;
    store.restoreNote(ui.pageId); openPage(ui.pageId, { keepView: true }); toast('복구했습니다');
  });
  $('#btn-add-icon').addEventListener('click', () => { if (ui.pageId) emojiPicker((e) => store.updateNote(ui.pageId, { icon: e }), false); });
  $('#page-icon').addEventListener('click', () => {
    const n = ui.pageId && store.getNote(ui.pageId);
    if (n && !n.deleted) emojiPicker((e) => store.updateNote(n.id, { icon: e }), true);
  });
  $('#btn-add-cover').addEventListener('click', () => {
    if (!ui.pageId) return;
    const keys = Object.keys(COVERS);
    store.updateNote(ui.pageId, { cover: keys[Math.floor(Math.random() * keys.length)] });
  });
  $('#btn-cover-change').addEventListener('click', () => { if (ui.pageId) coverPicker(ui.pageId); });
  $('#btn-cover-remove').addEventListener('click', () => { if (ui.pageId) store.updateNote(ui.pageId, { cover: '' }); });
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderTree(); });
  $('#editor-wrap').addEventListener('click', (e) => {
    if (['editor-wrap', 'editor', 'blocks'].includes(e.target.id)) editor.focusEnd();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyN') { e.preventDefault(); newPage(currentFolderId(), null); }
  });
  // 아이폰 키보드 위에 도구 막대를 붙이기 위한 키보드 높이
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const upd = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${kb}px`);
    };
    vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd); upd();
  }
}

function newestTopPage() {
  const all = store.listFolders().flatMap((f) => store.topPages(f.id));
  return all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
}

function init() {
  app.dataset.view = ui.view;
  bind();
  renderAll();
  const n = ui.pageId && store.getNote(ui.pageId);
  if (n && !n.deleted) openPage(n.id, { keepView: true });
  else {
    ui.pageId = null; showEditor(null);
    if (ui.view === 'page') setView('tree');
    if (!isMobile()) { const first = store.favorites()[0] || newestTopPage(); if (first) openPage(first.id, { keepView: true }); }
  }
  captureJoinParam();
  sync.init({ onStatus, onUser });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

store.init().then(init, (e) => { console.error(e); init(); });
