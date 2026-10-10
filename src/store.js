import { toMarkdownInline } from './rich.js';

// 데이터 저장소: 이 기기(IndexedDB, 안 되면 localStorage)에 항상 저장하고, 동기화는 sync.js가 담당한다.
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
    { ...newBlock('callout', '페이지 안에 페이지를 계속 만들어서 정리합니다. 목록에서 페이지 앞의 ▸ 를 누르면 하위 페이지가 펼쳐집니다.'), icon: '💡' },
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
    newBlock('number', '아이폰: 글을 쓸 때 키보드 위 막대의 + 로 블록 추가, ⋯ 로 이동·색·삭제'),
    { ...newBlock('callout', '아이콘과 커버는 오른쪽 위 페이지 메뉴(⋯)에서 바꿉니다. 커버는 눌러서 바꿀 수도 있습니다.'), icon: '🎨' },
  ];
  todo.blocks = [
    { ...newBlock('todo', 'Memo를 홈 화면에 추가하기'), checked: false },
    { ...newBlock('todo', '내 첫 페이지 만들기'), checked: false },
    { ...newBlock('todo', '지인과 함께 쓸 섹션 정하기'), checked: false },
  ];
  state.notes.push(top, guide, todo);
}

const normalize = (d) => ({ folders: d.folders || [], notes: d.notes || [], meta: { purged: [], ...(d.meta || {}) } });

// ---------- IndexedDB (용량이 커서 사진이 많아도 버틴다) ----------
let db = null;
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open('memo', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    setTimeout(() => reject(new Error('indexedDB timeout')), 4000);
  });
}
function idbReq(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const r = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(r && r.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
const idbGet = (key, s = 'kv') => idbReq(s, 'readonly', (o) => o.get(key));
const idbPut = (key, value, s = 'kv') => idbReq(s, 'readwrite', (o) => { o.put(value, key); });
const idbKeys = (s) => idbReq(s, 'readonly', (o) => o.getAllKeys());
const idbDel = (key, s) => idbReq(s, 'readwrite', (o) => { o.delete(key); });

// ---------- 사진: 페이지 데이터와 따로 저장해 입력이 가볍게 유지된다 ----------
const imgCache = new Map();
// 사진 id는 내용으로 만든다: 두 기기가 같은 사진을 같은 id로 알아본다
async function hashId(data) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return `img_${[...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  } catch { return `img_${uid()}`; }
}
export async function putImage(dataURL) {
  if (!db) return { src: dataURL };
  const id = await hashId(dataURL);
  await idbPut(id, dataURL, 'images');
  imgCache.set(id, dataURL);
  return { img: id };
}
export async function saveImage(id, data) {
  if (!db || typeof data !== 'string' || !data.startsWith('data:image/')) return;
  await idbPut(id, data, 'images');
  imgCache.set(id, data);
}
const usedImageIds = () => [...new Set(imageBlocks().map((b) => b.img).filter(Boolean))];
export async function missingImages() {
  if (!db) return [];
  const have = new Set(await idbKeys('images'));
  return usedImageIds().filter((id) => !have.has(id));
}
export function pendingImageUploads() { const up = new Set(state.meta.imgUp || []); return usedImageIds().filter((id) => !up.has(id)); }
export function markImageUploaded(id) { if (!(state.meta.imgUp || []).includes(id)) { state.meta.imgUp = [...(state.meta.imgUp || []), id]; persist(); } }
export function noteForImage(id) { const n = state.notes.find((x) => (x.blocks || []).some((b) => b.img === id)); return n ? n.id : null; }
export function notesWithImages(ids) { const s = new Set(ids); return state.notes.filter((x) => (x.blocks || []).some((b) => s.has(b.img))).map((x) => x.id); }
export function emitRemote(ids) { if (ids.length) listeners.forEach((fn) => fn('remote', ids)); }
export async function imageURL(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  if (!db) return '';
  const d = await idbGet(id, 'images');
  if (d) imgCache.set(id, d);
  return d || '';
}
function imageBlocks() {
  const out = [];
  for (const n of state.notes) for (const b of n.blocks || []) if (b.type === 'image') out.push(b);
  return out;
}
// 예전처럼 페이지 안에 들어 있던 사진을 사진 저장소로 옮기고, 아무 데서도 안 쓰는 사진은 지운다
async function migrateImages() {
  if (!db) return;
  for (const n of state.notes) {
    let moved = false;
    for (const b of n.blocks || []) {
      if (b.type === 'image' && b.src && b.src.startsWith('data:') && !b.img) {
        const id = await hashId(b.src);
        await idbPut(id, b.src, 'images');
        b.img = id; delete b.src; moved = true;
      }
    }
    // 이미 서버에 있는 페이지면 새 사진 참조와 사진을 다시 올리도록 표시
    if (moved && n.synced) { n.updated_at = now(); n.dirty = true; }
  }
}
// 아무 페이지(휴지통 포함)에서도 안 쓰는 사진 정리. 이 기기에서 Memo를 쓰는 탭이 하나일 때만 부른다
export async function gcImages() {
  if (!db) return;
  const used = new Set(usedImageIds());
  for (const k of await idbKeys('images')) if (!used.has(k)) await idbDel(k, 'images');
}
const BACKUP_KEY = 'memo.unsaved.v1';
function readBackup() {
  try { const raw = localStorage.getItem(BACKUP_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function readLocal() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

let state = normalize({});
export let storageKind = 'local';

// 앱 시작 시 한 번: 저장된 데이터를 불러오고, 예전 localStorage 데이터는 IndexedDB로 옮긴다
export async function init() {
  let data = null;
  try {
    db = await openDB();
    data = await idbGet('data');
    storageKind = 'idb';
    if (!data) {
      const old = readLocal();
      if (old) {
        data = old;
        await idbPut('data', JSON.parse(JSON.stringify(old)));
        try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
      }
    }
  } catch (e) {
    console.warn('IndexedDB unavailable, using localStorage', e);
    db = null; storageKind = 'local';
    data = readLocal();
  }
  // 앱을 닫는 순간 비상 저장해 둔 것이 더 최신이면 그걸 쓴다
  const bk = readBackup();
  if (bk && (!data || ((bk.meta && bk.meta.savedAt) || '') > ((data.meta && data.meta.savedAt) || ''))) data = bk;
  state = data ? normalize(data) : seed();
  if (!state.meta.demo2) {
    const f = state.folders.find((x) => !x.deleted);
    if (f) addDemo(f.id);
    state.meta.demo2 = true;
  }
  try { await migrateImages(); } catch (e) { console.warn('image migration failed', e); }
  flush();
  try { localStorage.removeItem(BACKUP_KEY); } catch { /* 무시 */ }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* 지원 안 함 */ }
}
const listeners = new Set();
let saveTimer = null;
let lockFn = () => null;

let writing = 0;
let writable = true;
// 다른 탭이 Memo를 쓰고 있으면 이 탭은 저장하지 않는다
export function setWritable(v) { writable = v; if (!v) { clearTimeout(saveTimer); saveTimer = null; } }
export function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!writable) return '';
  state.meta.savedAt = now();
  const json = JSON.stringify(state);
  if (db) {
    writing += 1;
    idbPut('data', JSON.parse(json))
      .catch((e) => { console.error(e); listeners.forEach((fn) => fn('save-error')); })
      .finally(() => { writing -= 1; });
    return json;
  }
  try { localStorage.setItem(KEY, json); }
  catch (e) { console.error(e); listeners.forEach((fn) => fn('save-error')); }
}
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
function commit(kind, ids) { persist(); listeners.forEach((fn) => fn(kind, ids)); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// 편집 중인 메모 id를 돌려주는 함수. 동기화가 편집 중인 메모를 덮어쓰지 않게 한다.
export function setLock(fn) { lockFn = fn; }

if (typeof document !== 'undefined') {
  // 앱을 닫거나 다른 앱으로 넘어갈 때: 비동기 저장이 끝나기 전에 꺼질 수 있어 즉시 쓰는 비상 사본도 남긴다
  const emergency = () => {
    if (!writable || (!saveTimer && !writing)) return;
    const json = flush() || JSON.stringify(state);
    try { localStorage.setItem(BACKUP_KEY, json); } catch { /* 용량 초과 시 포기 */ }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') emergency(); });
  window.addEventListener('pagehide', emergency);
}

// ---------- 조회 ----------
export const getFolder = (id) => state.folders.find((f) => f.id === id);
export const getNote = (id) => state.notes.find((n) => n.id === id);
export function listFolders() {
  return state.folders.filter((f) => !f.deleted).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
export function noteText(n) {
  return (n.blocks || []).map((b) => (b.rows ? b.rows.flat().join(' ') : b.url ? b.url : b.text || '')).join('\n');
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
  return !(n.title || '').trim() && !n.icon && !n.cover && !childPages(n.id).length
    && !(n.blocks || []).some((b) => b.type !== 'p' || (b.text || '').trim());
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
    blocks: JSON.parse(JSON.stringify(src.blocks || [])).map((b) => ({ ...b, id: uid() })),
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
// 부모 페이지 본문에 있는 이 페이지 링크 블록을 지운다
function unlinkFromParent(n) {
  const p = n.parent_id && getNote(n.parent_id);
  if (p && (p.blocks || []).some((b) => b.page_id === n.id)) { p.blocks = p.blocks.filter((b) => b.page_id !== n.id); touch(p); }
}
export function moveUnder(id, parentId) {
  const n = getNote(id); const p = getNote(parentId);
  if (!n || !p || id === parentId || ancestors(parentId).some((a) => a.id === id)) return false;
  unlinkFromParent(n);
  n.parent_id = parentId;
  for (const x of [n, ...descendants(id)]) { x.folder_id = p.folder_id; touch(x); }
  p.blocks = [...(p.blocks || []), { ...newBlock('page'), page_id: n.id }]; touch(p);
  commit('data');
  return true;
}
// 같은 단계 안에서 순서 바꾸기 (생성 시각을 맞바꿔 순서를 정한다)
export function reorderSibling(id, dir) {
  const n = getNote(id); if (!n) return false;
  const sibs = liveParent(n) ? childPages(n.parent_id) : topPages(n.folder_id);
  const i = sibs.findIndex((x) => x.id === id); const other = sibs[i + dir];
  if (!other) return false;
  let a = n.created_at; let b = other.created_at;
  if (a === b) b = new Date(Date.parse(b) + dir).toISOString();
  n.created_at = b; other.created_at = a;
  touch(n); touch(other); commit('data');
  return true;
}
export function allPages() { return state.notes.filter((n) => !n.deleted).sort(byCreated); }
export function moveNote(id, folderId) {
  const n = getNote(id); if (!n) return;
  unlinkFromParent(n);
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
// 올린 뒤: 서버가 기록한 시각과 올린 내용을 '기준 버전'으로 기억한다
export function markClean(kind, snaps, serverRows = []) {
  const at = new Map((serverRows || []).map((r) => [r.id, iso(r.updated_at)]));
  for (const s of snaps) {
    const it = state[kind].find((x) => x.id === s.id);
    if (!it) continue;
    it.synced = true;
    const srv = at.get(s.id) || s.updated_at;
    it.baseAt = srv;
    if (kind === 'notes') { it.baseHash = contentHash(s); it.baseLoc = pickLoc(s); }
    if (it.updated_at === s.updated_at) { it.dirty = false; it.updated_at = srv; }
  }
  persist();
}
// 서버가 거절한 항목(권한 없음)은 더 올리지 않는다. 다음 전체 동기화에서 정리된다
export function dropDenied(kind, ids) {
  for (const id of ids) { const it = state[kind].find((x) => x.id === id); if (it) { it.dirty = false; it.synced = true; it.baseAt = undefined; } }
  persist();
}
// 공유 섹션에서 나간 뒤: 남의 페이지는 지우고, 내가 만든 페이지는 내 기본 섹션으로 옮긴다
export function forgetFolder(fid, myId) {
  state.folders = state.folders.filter((f) => f.id !== fid);
  state.notes = state.notes.filter((n) => !(n.folder_id === fid && n.owner_id && n.owner_id !== myId));
  const moved = rescueOrphans(true);
  commit('data', moved);
}
export const getMeta = (k) => state.meta[k];
export function setMeta(k, v) { state.meta[k] = v; persist(); }

// 계정을 바꾸거나 로그아웃하며 지울 때: 이 기기의 페이지·사진을 비우고 처음 상태로
export async function resetLocal() {
  if (db) { try { for (const k of await idbKeys('images')) await idbDel(k, 'images'); } catch (e) { console.warn(e); } }
  imgCache.clear();
  state = seed();
  addDemo(state.folders[0].id);
  state.meta.demo2 = true;
  flush();
  listeners.forEach((fn) => fn('reset'));
}

// 두 번째 기기에서 처음 로그인할 때: 손대지 않은 둘러보기 페이지와 빈 기본 섹션은 올리지 않고 버린다
const DEMO_TITLES = new Set(['Memo 둘러보기', '블록 사용법', '이번 주 할 일']);
export function dropPristineDemo() {
  const pristine = (x) => !x.synced && x.created_at === x.updated_at;
  const drop = new Set(state.notes.filter((n) => DEMO_TITLES.has(n.title) && pristine(n)).map((n) => n.id));
  state.notes = state.notes.filter((n) => !drop.has(n.id));
  const emptySeed = state.folders.filter((f) => pristine(f) && !state.notes.some((n) => n.folder_id === f.id));
  const fdrop = new Set(emptySeed.map((f) => f.id));
  state.folders = state.folders.filter((f) => !fdrop.has(f.id));
  if (drop.size || fdrop.size) { persist(); listeners.forEach((fn) => fn('remote', [...drop, ...fdrop])); }
  return drop.size + fdrop.size;
}
export function clearPurged(ids) {
  state.meta.purged = state.meta.purged.filter((id) => !ids.includes(id));
  persist();
}

const iso = (v) => (v ? new Date(v).toISOString() : now());

// ---------- 병합 ----------
function hashStr(str) { let h = 5381; for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return `${(h >>> 0).toString(36)}:${str.length}`; }
function contentHash(x) { return hashStr(JSON.stringify([x.title || '', x.blocks || [], x.icon || '', x.cover || ''])); }
const LOC = ['folder_id', 'parent_id', 'deleted', 'pinned'];
const locVal = (x, k) => (k === 'deleted' || k === 'pinned' ? !!x[k] : x[k] || null);
function pickLoc(x) { const o = {}; for (const k of LOC) o[k] = locVal(x, k); return o; }

function conflictCopy(r) {
  const t = now();
  const copy = {
    ...strip(r), id: uid(), owner_id: undefined, title: `${(r.title || '').trim() || '제목 없음'} (다른 기기 버전)`, pinned: false, deleted: false,
    created_at: t, updated_at: t, dirty: true, synced: false, baseAt: undefined,
    blocks: JSON.parse(JSON.stringify(r.blocks || [])).map((b) => ({ ...b, id: uid() })),
  };
  state.notes.push(copy);
  return copy.id;
}
// 이 기기도 고쳤고 서버도 바뀐 페이지 합치기.
// 위치(섹션·상위 페이지·휴지통·즐겨찾기)는 바꾼 쪽을 따르고, 내용은 한쪽만 바뀌었으면 그쪽, 둘 다 다르게 바뀌었으면 서버 쪽을 사본으로 남긴다.
function reconcileNote(local, r) {
  const rh = contentHash(r); const lh = contentHash(local);
  let copy = false;
  if (local.baseHash) {
    const rC = rh !== local.baseHash; const lC = lh !== local.baseHash;
    if (rC && !lC) { local.title = r.title; local.blocks = r.blocks; local.icon = r.icon; local.cover = r.cover; }
    else if (rC && lC && rh !== lh) copy = true;
  } else if (rh !== lh) copy = true;
  if (local.baseLoc) {
    for (const k of LOC) {
      const rv = locVal(r, k);
      if (rv !== local.baseLoc[k] && locVal(local, k) === local.baseLoc[k]) local[k] = rv;
    }
  }
  local.baseAt = r.updated_at; local.baseHash = rh; local.baseLoc = pickLoc(r);
  return copy;
}
// 올릴 버전은 서버에 있던 버전보다 항상 새것으로 표시한다
export function bumpStale() {
  for (const kind of ['folders', 'notes']) {
    for (const it of state[kind]) {
      if (it.dirty && it.baseAt && it.updated_at <= it.baseAt) it.updated_at = new Date(Date.parse(it.baseAt) + 1).toISOString();
    }
  }
}
// 올리기 직전 검사: 서버 버전과 비교해 합치고, 필요하면 사본을 남긴 뒤 올린다 (덮어써서 사라지는 일이 없게)
export function preserveConflicts(rows) {
  const changed = []; const names = [];
  for (const r0 of rows || []) {
    const local = getNote(r0.id);
    if (!local || !local.dirty) continue;
    const r = { ...r0, updated_at: iso(r0.updated_at) };
    if (local.baseAt && r.updated_at === local.baseAt) continue;
    if (reconcileNote(local, r)) { changed.push(conflictCopy(r)); names.push(r.title || '제목 없음'); }
    changed.push(local.id);
  }
  if (changed.length) { persist(); listeners.forEach((fn) => fn('remote', changed)); }
  if (names.length) listeners.forEach((fn) => fn('conflict', names));
}
export function preserveFolderConflicts(rows) {
  for (const r0 of rows || []) {
    const local = getFolder(r0.id);
    if (!local || !local.dirty) continue;
    const at = iso(r0.updated_at);
    if (local.baseAt && at === local.baseAt) continue;
    if (r0.deleted && !local.deleted) Object.assign(local, r0, { updated_at: at, dirty: false, synced: true, baseAt: at }); // 소유자가 지운 섹션은 되살리지 않는다
    else local.baseAt = at;
  }
  persist();
}
// 지워진 섹션(또는 볼 수 없게 된 섹션)에 남은 페이지는 기본 섹션으로 옮겨서 보이게 한다
function rescueOrphans(full) {
  const moved = state.notes.filter((n) => {
    if (n.deleted || !n.folder_id) return false;
    const f = getFolder(n.folder_id);
    return (f && f.deleted) || (!f && full);
  });
  if (!moved.length) return [];
  let target = listFolders()[0];
  if (!target) {
    const t = now();
    target = { id: uid(), name: '개인 페이지', created_at: t, updated_at: t, deleted: false, dirty: true };
    state.folders.push(target);
  }
  for (const n of moved) {
    n.folder_id = target.id;
    if (n.parent_id) { const p = getNote(n.parent_id); if (!p || p.folder_id !== target.id) n.parent_id = null; }
    touch(n);
  }
  return moved.map((n) => n.id);
}

// 서버 데이터 병합. full=true면 서버 전체 목록이라 서버에 없는 항목을 지울 수 있다.
export function mergeRemote(rFolders, rNotes, myId, { full = true } = {}) {
  const changed = new Set();
  const conflicts = [];
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
      const base = kind === 'notes' ? { baseHash: contentHash(r), baseLoc: pickLoc(r) } : {};
      if (!local) { arr.push({ ...r, dirty: false, synced: true, baseAt: r.updated_at, ...base }); changed.add(r.id); continue; }
      local.synced = true; local.shared = r.shared; local.owner_id = r.owner_id;
      if (r.updated_at === local.baseAt) continue; // 마지막 동기화 이후 서버 쪽 변화 없음
      if (local.dirty) {
        if (kind === 'notes') {
          const typing = locked === local.id && !(local.baseHash && contentHash(local) === local.baseHash) && contentHash(local) !== contentHash(r);
          if (locked === local.id && !typing) continue; // 편집 중: 끝난 뒤 다음 동기화에서 합친다
          if (reconcileNote(local, r)) conflicts.push(r);
          changed.add(local.id);
        } else if (r.deleted && !local.deleted) {
          Object.assign(local, r, { dirty: false, baseAt: r.updated_at }); changed.add(r.id);
        } else local.baseAt = r.updated_at;
        continue;
      }
      if (kind === 'notes' && locked === local.id) continue; // 편집이 끝난 뒤 다음 동기화에서 반영
      Object.assign(local, r, { dirty: false, baseAt: r.updated_at, ...base });
      changed.add(r.id);
    }
    if (!full) return;
    // 서버에서 사라진 항목(다른 기기에서 영구 삭제, 공유 해제)은 로컬에서도 지운다
    const keep = arr.filter((x) => !(x.synced && !x.dirty && !seen.has(x.id) && !(kind === 'notes' && locked === x.id)));
    if (keep.length !== arr.length) arr.filter((x) => !keep.includes(x)).forEach((x) => changed.add(x.id));
    state[kind] = keep;
  };
  apply('folders', rFolders || []);
  apply('notes', rNotes || []);
  for (const r of conflicts) changed.add(conflictCopy(r));
  for (const id of rescueOrphans(full)) changed.add(id);
  persist();
  if (changed.size) listeners.forEach((fn) => fn('remote', [...changed]));
  if (conflicts.length) listeners.forEach((fn) => fn('conflict', conflicts.map((r) => r.title || '제목 없음')));
  return changed.size;
}

// ---------- 내보내기/가져오기 ----------
const strip = ({ dirty, synced, shared, linked, baseAt, baseHash, baseLoc, ...rest }) => rest;
// 백업 파일에는 사진도 함께 넣는다
export async function exportData() {
  const images = {};
  for (const b of imageBlocks()) if (b.img && !images[b.img]) images[b.img] = await imageURL(b.img);
  return JSON.stringify({ app: 'memo', version: 2, exported_at: now(), folders: state.folders.map(strip), notes: state.notes.map(strip), images }, null, 2);
}
export async function importData(obj) {
  if (!obj || !Array.isArray(obj.notes)) throw new Error('형식이 맞지 않는 파일입니다');
  dropPristineDemo();
  for (const [id, url] of Object.entries(obj.images || {})) {
    if (typeof url === 'string' && url.startsWith('data:image/')) {
      if (db) await idbPut(id, url, 'images'); imgCache.set(id, url);
    }
  }
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

function mdInline(b) { return b.html ? toMarkdownInline(b.html) : b.text || ''; }
export function toMarkdown(n) {
  const out = [];
  let num = 0;
  if (n.title) out.push(`# ${n.title}`, '');
  for (const b of n.blocks || []) {
    const pad = '  '.repeat(b.indent || 0);
    const t = pad + mdInline(b);
    num = b.type === 'number' ? num + 1 : 0;
    switch (b.type) {
      case 'h1': out.push(`## ${t}`); break;
      case 'h2': out.push(`### ${t}`); break;
      case 'bullet': out.push(`${pad}- ${mdInline(b)}`); break;
      case 'toggle': out.push(`${pad}- ▸ ${mdInline(b)}`); break;
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
      case 'link': out.push(b.url || ''); break;
      case 'image': out.push('(이미지)'); break;
      default: out.push(t);
    }
  }
  return out.join('\n');
}
