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
  const folder = { id: uid(), name: '메모', created_at: t, updated_at: t, deleted: false, dirty: true };
  const note = {
    id: uid(), folder_id: folder.id, title: '시작하기', pinned: true, deleted: false,
    created_at: t, updated_at: t, dirty: true,
    blocks: [
      newBlock('p', '메모장처럼 바로 쓰고, 폴더로 정리하세요.'),
      newBlock('h2', '빠른 입력'),
      newBlock('bullet', '줄 맨 앞에 / 를 입력하면 블록 메뉴가 열립니다.'),
      newBlock('bullet', '# 제목, ## 소제목, - 목록, [] 체크박스, > 인용, --- 구분선'),
      newBlock('bullet', '아래 도구 막대로도 블록 형식을 바꿀 수 있습니다.'),
      { ...newBlock('todo', '첫 메모 써보기'), checked: false },
      newBlock('h2', '기기 간 동기화와 공유'),
      newBlock('p', '설정에서 로그인하면 컴퓨터와 아이폰이 같은 메모를 봅니다. 폴더 메뉴(⋯)에서 공유 링크를 만들면 지인과 그 폴더를 함께 씁니다.'),
    ],
  };
  return { folders: [folder], notes: [note], meta: { purged: [] } };
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
export function noteText(n) { return (n.blocks || []).map((b) => b.text || '').join('\n'); }
export function preview(n) {
  const b = (n.blocks || []).find((x) => x.text && x.text.trim());
  return b ? b.text.trim().split('\n')[0] : '';
}
export function isEmptyNote(n) {
  return !(n.title || '').trim()
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

export function createNote(folderId) {
  const t = now();
  const n = {
    id: uid(), folder_id: folderId, title: '', blocks: [newBlock()], pinned: false, deleted: false,
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
export function trashNote(id) { updateNote(id, { deleted: true }); }
export function restoreNote(id) {
  const n = getNote(id); if (!n) return;
  const f = getFolder(n.folder_id);
  const patch = { deleted: false };
  if (!f || f.deleted) patch.folder_id = ensureDefaultFolder().id;
  updateNote(id, patch);
}
export function purgeNote(id) {
  const n = getNote(id); if (!n) return;
  state.notes = state.notes.filter((x) => x.id !== id);
  if (n.synced) state.meta.purged.push(id);
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
    const t = b.text || '';
    num = b.type === 'number' ? num + 1 : 0;
    switch (b.type) {
      case 'h1': out.push(`## ${t}`); break;
      case 'h2': out.push(`### ${t}`); break;
      case 'bullet': out.push(`- ${t}`); break;
      case 'number': out.push(`${num}. ${t}`); break;
      case 'todo': out.push(`- [${b.checked ? 'x' : ' '}] ${t}`); break;
      case 'quote': out.push(`> ${t}`); break;
      case 'divider': out.push('---'); break;
      case 'image': out.push('(이미지)'); break;
      default: out.push(t);
    }
  }
  return out.join('\n');
}
