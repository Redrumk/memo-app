// 데이터 저장소: 이 기기(localStorage)에 항상 저장하고, 동기화는 sync.js가 담당한다.
// 각 항목의 dirty=서버에 아직 안 올라감, synced=서버에 한 번이라도 올라감, shared=다른 사람 소유

const KEY = 'memo.data.v1';

export const uid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));
export const now = () => new Date().toISOString();
export const newBlock = (type = 'p', text = '') => ({ id: uid(), type, text });

function seed() {
  const t = now();
  const folder = { id: uid(), name: '개인 페이지', created_at: t, updated_at: t, deleted: false, dirty: true };
  return { folders: [folder], notes: [], meta: { purged: [] } };
}

// 노션식 둘러보기 페이지 (처음 한 번만 추가)
function addDemo(folderId) {
  const base = Date.now();
  const mk = (k, o) => {
    const t = new Date(base + k).toISOString();
    return { id: uid(), folder_id: folderId, parent_id: null, title: '', icon: '', cover: '', pinned: false, deleted: false, created_at: t, updated_at: t, dirty: true, blocks: [], ...o };
  };
  const top = mk(0, { title: 'Memo 둘러보기', icon: '👋', cover: 'sand' });
  const guide = mk(1, { title: '블록 사용법', icon: '🧱', parent_id: top.id });
  const todo = mk(2, { title: '이번 주 할 일', icon: '✅', parent_id: top.id });
  top.blocks = [
    { ...newBlock('callout', '페이지 안에 페이지를 계속 만들어서 정리합니다. 왼쪽 목록의 ▸ 를 누르면 하위 페이지가 펼쳐집니다.'), icon: '💡' },
    newBlock('h2', '하위 페이지'),
    { ...newBlock('page'), page_id: guide.id },
    { ...newBlock('page'), page_id: todo.id },
    newBlock('h2', '바로 써보기'),
    newBlock('p', '빈 줄에서 / 를 누르고 "페이지"를 고르면 이 안에 새 페이지가 생깁니다.'),
    newBlock('p', ''),
  ];
  guide.blocks = [
    newBlock('h2', '줄 맨 앞 단축 입력'),
    newBlock('bullet', '# 제목, ## 소제목'),
    newBlock('bullet', '- 목록, 1. 번호 목록, [] 체크박스'),
    newBlock('bullet', '> 토글, " 인용, --- 구분선'),
    newBlock('bullet', 'Tab 들여쓰기, Shift+Tab 내어쓰기'),
    newBlock('h2', '블록 다루기'),
    newBlock('number', '컴퓨터: 블록 왼쪽 ⋮⋮ 를 끌면 순서 변경, 누르면 메뉴'),
    newBlock('number', '아이폰: 아래 도구 막대의 ↑ ↓ 와 ⋯'),
    { ...newBlock('callout', '아이콘과 커버는 제목 위에 마우스를 올리거나, 페이지 메뉴(⋯)에서 바꿉니다.'), icon: '🎨' },
  ];
  todo.blocks = [
    { ...newBlock('todo', 'Memo를 홈 화면에 추가하기'), checked: false },
    { ...newBlock('todo', '내 첫 페이지 만들기'), checked: false },
    { ...newBlock('todo', '지인과 함께 쓸 섹션 정하기'), checked: false },
  ];
  state.notes.push(top, guide, todo);
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { folders: d.folders || [], notes: d.notes || [], meta: { purged: [], ...(d.meta || {}) } };
    }
  } catch (e) { console.warn('load failed', e); }
  return seed();
}

let state = load();
if (!state.meta.demo2) {
  const f = state.folders.find((x) => !x.deleted);
  if (f) addDemo(f.id);
  state.meta.demo2 = true;
}
const listeners = new Set();
let saveTimer = null;
let lockFn = () => null;

export function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error(e); listeners.forEach((fn) => fn('save-error')); }
}
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
function commit(kind, ids) { persist(); listeners.forEach((fn) => fn(kind, ids)); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// 편집 중인 메모 id를 돌려주는 함수. 동기화가 편집 중인 메모를 덮어쓰지 않게 한다.
export function setLock(fn) { lockFn = fn; }

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flush(); });
  window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
}

// ---------- 조회 ----------
export const getFolder = (id) => state.folders.find((f) => f.id === id);
export const getNote = (id) => state.notes.find((n) => n.id === id);
export function listFolders() {
  return state.folders.filter((f) => !f.deleted).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
export function noteText(n) {
  return (n.blocks || []).map((b) => (b.rows ? b.rows.flat().join(' ') : b.text || '')).join('\n');
}
export function preview(n) {
  const b = (n.blocks || []).find((x) => x.text && x.text.trim());
  return b ? b.text.trim().split('\n')[0] : '';
}
const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
function liveParent(n) {
  if (!n.parent_id) return null;
  const p = getNote(n.parent_id);
  return p && !p.deleted ? p : null;
}
export function childPages(id) { return state.notes.filter((n) => !n.deleted && n.parent_id === id).sort(byCreated); }
export function topPages(folderId) { return state.notes.filter((n) => !n.deleted && n.folder_id === folderId && !liveParent(n)).sort(byCreated); }
export function favorites() { return state.notes.filter((n) => !n.deleted && n.pinned).sort(byCreated); }
export function ancestors(id) {
  const out = []; const seen = new Set([id]);
  let n = getNote(id);
  while (n) {
    const p = liveParent(n);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id); out.unshift(p); n = p;
  }
  return out;
}
function descendants(id) {
  const out = []; const stack = [id]; const seen = new Set([id]);
  while (stack.length) {
    const cur = stack.pop();
    for (const n of state.notes) if (n.parent_id === cur && !seen.has(n.id)) { seen.add(n.id); out.push(n); stack.push(n.id); }
  }
  return out;
}
export function isEmptyNote(n) {
  return !(n.title || '').trim() && !n.icon && !childPages(n.id).length
    && !(n.blocks || []).some((b) => (b.text || '').trim() || b.type === 'image' || b.type === 'divider');
}
// folderId: 'all' | 'trash' | 폴더 id
export function listNotes(folderId, query = '') {
  const q = query.trim().toLowerCase();
  let list = state.notes.filter((n) => (folderId === 'trash' ? n.deleted : !n.deleted));
  if (folderId !== 'all' && folderId !== 'trash') list = list.filter((n) => n.folder_id === folderId);
  if (q) list = list.filter((n) => (n.title || '').toLowerCase().includes(q) || noteText(n).toLowerCase().includes(q));
  return list.sort((a, b) => ((b.pinned && !b.deleted ? 1 : 0) - (a.pinned && !a.deleted ? 1 : 0))
    || (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

// ---------- 변경 ----------
function touch(item) { item.updated_at = now(); item.dirty = true; }

export function createFolder(name) {
  const t = now();
  const f = { id: uid(), name, created_at: t, updated_at: t, deleted: false, dirty: true };
  state.folders.push(f);
  commit('data');
  return f;
}
export function ensureDefaultFolder() { return listFolders()[0] || createFolder('메모'); }
export function renameFolder(id, name) {
  const f = getFolder(id); if (!f) return;
  f.name = name; touch(f); commit('data');
}
export function deleteFolder(id) {
  const f = getFolder(id); if (!f) return;
  f.deleted = true; touch(f);
  state.notes.forEach((n) => { if (n.folder_id === id && !n.deleted) { n.deleted = true; touch(n); } });
  commit('data');
}
// 서버에 안 올리는 이 기기 전용 표시값
export function setLocal(kind, id, patch) {
  const it = state[kind].find((x) => x.id === id);
  if (it) { Object.assign(it, patch); commit('local'); }
}

export function createNote(folderId, parentId = null) {
  const t = now();
  const n = {
    id: uid(), folder_id: folderId, parent_id: parentId, icon: '', cover: '', title: '', blocks: [newBlock()], pinned: false, deleted: false,
    created_at: t, updated_at: t, dirty: true,
  };
  state.notes.push(n);
  commit('data');
  return n;
}
export function updateNote(id, patch, kind = 'data') {
  const n = getNote(id); if (!n) return;
  Object.assign(n, patch); touch(n); commit(kind, [id]);
}
export function duplicateNote(id) {
  const src = getNote(id); if (!src) return null;
  const t = now();
  const n = {
    ...strip(src), id: uid(), title: src.title ? `${src.title} 사본` : '', pinned: false, deleted: false,
    owner_id: undefined, created_at: t, updated_at: t, dirty: true, synced: false,
    blocks: (src.blocks || []).map((b) => ({ ...b, id: uid() })),
  };
  state.notes.push(n);
  commit('data');
  return n;
}
// 휴지통/복구/영구삭제는 하위 페이지까지 함께 처리한다
export function trashNote(id) {
  const n = getNote(id); if (!n) return;
  for (const x of [n, ...descendants(id)]) if (!x.deleted) { x.deleted = true; touch(x); }
  commit('data');
}
export function restoreNote(id) {
  const n = getNote(id); if (!n) return;
  const f = getFolder(n.folder_id);
  const fid = !f || f.deleted ? ensureDefaultFolder().id : n.folder_id;
  if (n.parent_id) { const p = getNote(n.parent_id); if (!p || p.deleted) n.parent_id = null; }
  for (const x of [n, ...descendants(id)]) if (x.deleted || x.folder_id !== fid) { x.deleted = false; x.folder_id = fid; touch(x); }
  commit('data');
}
export function purgeNote(id) {
  const n = getNote(id); if (!n) return;
  const ids = new Set([id, ...descendants(id).map((x) => x.id)]);
  for (const x of state.notes) if (ids.has(x.id) && x.synced) state.meta.purged.push(x.id);
  state.notes = state.notes.filter((x) => !ids.has(x.id));
  commit('data');
}
export function moveNote(id, folderId) {
  const n = getNote(id); if (!n) return;
  n.parent_id = null;
  for (const x of [n, ...descendants(id)]) { x.folder_id = folderId; touch(x); }
  commit('data');
}
export function emptyTrash() {
  const ids = state.notes.filter((n) => n.deleted).map((n) => n.id);
  for (const n of state.notes) if (n.deleted && n.synced) state.meta.purged.push(n.id);
  state.notes = state.notes.filter((n) => !n.deleted);
  commit('data');
  return ids.length;
}

// ---------- 동기화용 ----------
export function dirtyItems() {
  return {
    folders: state.folders.filter((f) => f.dirty).map((f) => ({ ...f })),
    notes: state.notes.filter((n) => n.dirty).map((n) => ({ ...n })),
    purged: [...state.meta.purged],
  };
}
export function markClean(kind, snaps) {
  for (const s of snaps) {
    const it = state[kind].find((x) => x.id === s.id);
    if (!it) continue;
    it.synced = true;
    if (it.updated_at === s.updated_at) it.dirty = false;
  }
  persist();
}
export function clearPurged(ids) {
  state.meta.purged = state.meta.purged.filter((id) => !ids.includes(id));
  persist();
}

const iso = (v) => (v ? new Date(v).toISOString() : now());

// 서버 데이터 병합: 더 최근에 수정된 쪽이 이긴다(last-write-wins)
export function mergeRemote(rFolders, rNotes, myId) {
  const changed = new Set();
  const purged = new Set(state.meta.purged);
  const locked = lockFn();
  const apply = (kind, rows) => {
    const arr = state[kind];
    const seen = new Set();
    for (const r0 of rows) {
      if (purged.has(r0.id)) continue;
      seen.add(r0.id);
      const r = { ...r0, created_at: iso(r0.created_at), updated_at: iso(r0.updated_at), shared: !!myId && r0.owner_id !== myId };
      const local = arr.find((x) => x.id === r.id);
      if (!local) { arr.push({ ...r, dirty: false, synced: true }); changed.add(r.id); continue; }
      local.synced = true; local.shared = r.shared; local.owner_id = r.owner_id;
      if (kind === 'notes' && locked === local.id) continue;
      if (local.dirty && local.updated_at >= r.updated_at) continue;
      if (local.updated_at !== r.updated_at || local.dirty) {
        Object.assign(local, r, { dirty: false });
        changed.add(r.id);
      }
    }
    // 서버에서 사라진 항목(다른 기기에서 영구 삭제, 공유 해제)은 로컬에서도 지운다
    const keep = arr.filter((x) => !(x.synced && !x.dirty && !seen.has(x.id) && !(kind === 'notes' && locked === x.id)));
    if (keep.length !== arr.length) arr.filter((x) => !keep.includes(x)).forEach((x) => changed.add(x.id));
    state[kind] = keep;
  };
  apply('folders', rFolders || []);
  apply('notes', rNotes || []);
  persist();
  if (changed.size) listeners.forEach((fn) => fn('remote', [...changed]));
  return changed.size;
}

// ---------- 내보내기/가져오기 ----------
const strip = ({ dirty, synced, shared, linked, ...rest }) => rest;
export function exportData() {
  return JSON.stringify({ app: 'memo', version: 1, exported_at: now(), folders: state.folders.map(strip), notes: state.notes.map(strip) }, null, 2);
}
export function importData(obj) {
  if (!obj || !Array.isArray(obj.notes)) throw new Error('형식이 맞지 않는 파일입니다');
  let added = 0;
  for (const f of obj.folders || []) {
    if (f && f.id && f.name && !getFolder(f.id)) state.folders.push({ ...strip(f), dirty: true, synced: false });
  }
  for (const n of obj.notes) {
    if (n && n.id && !getNote(n.id)) {
      state.notes.push({ ...strip(n), blocks: Array.isArray(n.blocks) ? n.blocks : [], dirty: true, synced: false });
      added++;
    }
  }
  commit('data');
  return added;
}

export function toMarkdown(n) {
  const out = [];
  let num = 0;
  if (n.title) out.push(`# ${n.title}`, '');
  for (const b of n.blocks || []) {
    const pad = '  '.repeat(b.indent || 0);
    const t = pad + (b.text || '');
    num = b.type === 'number' ? num + 1 : 0;
    switch (b.type) {
      case 'h1': out.push(`## ${t}`); break;
      case 'h2': out.push(`### ${t}`); break;
      case 'bullet': out.push(`${pad}- ${b.text || ''}`); break;
      case 'toggle': out.push(`${pad}- ▸ ${b.text || ''}`); break;
      case 'table': {
        const rows = b.rows || [];
        rows.forEach((r, i) => { out.push(`| ${r.join(' | ')} |`); if (i === 0) out.push(`| ${r.map(() => '---').join(' | ')} |`); });
        break;
      }
      case 'number': out.push(`${num}. ${t}`); break;
      case 'callout': out.push(`> ${b.icon || '💡'} ${t}`); break;
      case 'page': { const p = getNote(b.page_id); out.push(`[${(p && p.title) || '제목 없음'}]`); break; }
      case 'todo': out.push(`- [${b.checked ? 'x' : ' '}] ${t}`); break;
      case 'quote': out.push(`> ${t}`); break;
      case 'divider': out.push('---'); break;
      case 'image': out.push('(이미지)'); break;
      default: out.push(t);
    }
  }
  return out.join('\n');
}
