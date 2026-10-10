// 앱 화면: 폴더 → 메모 목록 → 편집기 (휴대폰에서는 한 화면씩, 컴퓨터에서는 3단)
import * as store from './store.js';
import * as sync from './sync.js';
import { createEditor } from './editor.js';
import { el, icon, actionSheet, openOverlay, toast, formatDate, formatFull, download, confirmDialog, alertDialog, promptDialog } from './ui.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const UI_KEY = 'memo.ui.v1';
const JOIN_KEY = 'memo.pendingJoin';

function readUI() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; }
}
const ui = { folderId: 'all', noteId: null, view: 'folders', ...readUI() };
let query = '';
let settingsRedraw = null;

const isMobile = () => window.matchMedia('(max-width: 759px)').matches;
function saveUI() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ folderId: ui.folderId, noteId: ui.noteId, view: ui.view })); } catch { /* 저장 불가 환경 */ }
}
function setView(v) { ui.view = v; app.dataset.view = v; saveUI(); }

const editor = createEditor({
  blocksEl: $('#blocks'),
  titleEl: $('#note-title'),
  toolbarEl: $('#toolbar'),
  onChange: (n) => store.updateNote(n.id, { title: n.title, blocks: n.blocks }, 'content'),
});
store.setLock(() => (editor.isFocused() ? editor.currentId() : null));

// ---------- 렌더링 ----------
function folderButton(id, label, count, iconName) {
  return el('button', { class: 'folder-item' + (ui.folderId === id ? ' active' : ''), type: 'button', onclick: () => selectFolder(id) },
    icon(iconName), el('span', { class: 'folder-name' }, label), el('span', { class: 'count' }, count || ''));
}

function renderFolders() {
  const list = $('#folder-list');
  list.textContent = '';
  list.append(folderButton('all', '모든 메모', store.listNotes('all').length, 'notes'));
  const fs = store.listFolders();
  if (fs.length) list.append(el('div', { class: 'section-label' }, '폴더'));
  for (const f of fs) list.append(folderButton(f.id, f.name, store.listNotes(f.id).length, f.shared || f.linked ? 'shared' : 'folder'));
  list.append(el('div', { class: 'section-label' }, ''));
  list.append(folderButton('trash', '최근 삭제된 항목', store.listNotes('trash').length, 'trash'));
}

function folderTitle() {
  if (ui.folderId === 'all') return '모든 메모';
  if (ui.folderId === 'trash') return '최근 삭제된 항목';
  return store.getFolder(ui.folderId)?.name || '메모';
}

function renderNotes() {
  $('#notes-title').textContent = folderTitle();
  const notes = store.listNotes(ui.folderId, query);
  const list = $('#note-list');
  list.textContent = '';
  if (!notes.length) {
    list.append(el('div', { class: 'empty small' }, query ? '검색 결과가 없습니다' : ui.folderId === 'trash' ? '비어 있습니다' : '메모가 없습니다'));
  }
  const hasPinned = ui.folderId !== 'trash' && notes.some((n) => n.pinned);
  let pinHead = false; let restHead = false;
  for (const n of notes) {
    if (hasPinned && n.pinned && !pinHead) { list.append(el('div', { class: 'section-label' }, '고정됨')); pinHead = true; }
    if (hasPinned && !n.pinned && !restHead) { list.append(el('div', { class: 'section-label' }, '메모')); restHead = true; }
    const title = (n.title || '').trim();
    const pv = store.preview(n);
    const folderName = ui.folderId === 'all' || ui.folderId === 'trash' ? store.getFolder(n.folder_id)?.name : null;
    list.append(el('button', { class: 'note-item' + (n.id === ui.noteId ? ' active' : ''), type: 'button', onclick: () => openNote(n.id) },
      el('h3', {}, title || pv || '새로운 메모'),
      el('p', {}, el('time', {}, formatDate(n.updated_at)), (title ? pv : '') || '추가 텍스트 없음'),
      folderName ? el('span', { class: 'note-folder' }, icon(store.getFolder(n.folder_id)?.shared ? 'shared' : 'folder'), folderName) : null));
  }
  $('#note-count').textContent = notes.length ? `메모 ${notes.length}개` : '';
  $('#btn-new-note').hidden = ui.folderId === 'trash';
}

function renderMeta() {
  const n = ui.noteId && store.getNote(ui.noteId);
  if (!n) return;
  const f = store.getFolder(n.folder_id);
  $('#note-meta').textContent = [formatFull(n.updated_at), f?.name, f?.shared ? '공유 폴더' : null].filter(Boolean).join(' · ');
}

function showEditor(n) {
  const on = !!n;
  $('#editor').hidden = !on;
  $('#empty-editor').hidden = on;
  $('#btn-note-menu').hidden = !on;
  $('#toolbar').hidden = !on || !!n.deleted;
  $('#trash-banner').hidden = !(n && n.deleted);
}

function renderAll() {
  if (ui.folderId !== 'all' && ui.folderId !== 'trash') {
    const f = store.getFolder(ui.folderId);
    if (!f || f.deleted) ui.folderId = 'all';
  }
  if (ui.noteId && !store.getNote(ui.noteId)) {
    ui.noteId = null; editor.close(); showEditor(null);
    if (ui.view === 'editor') setView('notes');
  }
  renderFolders(); renderNotes(); renderMeta();
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
    if (ui.noteId && ids && ids.includes(ui.noteId)) {
      const n = store.getNote(ui.noteId);
      if (n) { editor.refreshIfIdle(); showEditor(n); }
    }
  } else if (kind !== 'local') {
    sync.scheduleSync();
  }
  scheduleRender();
});

// ---------- 동작 ----------
function selectFolder(id) {
  ui.folderId = id; query = ''; $('#search').value = '';
  setView('notes'); renderAll();
}

function cleanupEmpty(nextId) {
  const cur = ui.noteId && store.getNote(ui.noteId);
  if (cur && cur.id !== nextId && !cur.deleted && store.isEmptyNote(cur)) store.purgeNote(cur.id);
}

function openNote(id, { focus, keepView } = {}) {
  cleanupEmpty(id);
  const n = store.getNote(id); if (!n) return;
  ui.noteId = id;
  editor.open(n, { readOnly: n.deleted });
  showEditor(n);
  if (!keepView) setView('editor');
  renderNotes(); renderMeta(); saveUI();
  if (focus === 'title') $('#note-title').focus();
}

function leaveEditor() {
  cleanupEmpty(null);
  ui.noteId = null; editor.close(); showEditor(null);
  setView('notes'); renderAll();
}

function newNote() {
  let fid = ui.folderId;
  const f = store.getFolder(fid);
  if (fid === 'all' || fid === 'trash' || !f || f.deleted) fid = store.ensureDefaultFolder().id;
  if (ui.folderId === 'trash') ui.folderId = fid;
  query = ''; $('#search').value = '';
  const n = store.createNote(fid);
  openNote(n.id, { focus: 'title' });
}

async function newFolder() {
  const name = await promptDialog('새 폴더', '', { ok: '만들기', placeholder: '폴더 이름' });
  if (!name || !name.trim()) return;
  const f = store.createFolder(name.trim());
  selectFolder(f.id);
}

async function folderMenu() {
  if (ui.folderId === 'trash') {
    const a = await actionSheet('최근 삭제된 항목', [{ label: '모두 영구 삭제', value: 'empty', danger: true }]);
    if (a === 'empty' && await confirmDialog('삭제된 메모를 모두 영구 삭제할까요? 되돌릴 수 없습니다.', { ok: '영구 삭제', danger: true })) {
      const c = store.emptyTrash(); toast(`${c}개를 영구 삭제했습니다`);
    }
    return;
  }
  if (ui.folderId === 'all') {
    const a = await actionSheet(null, [{ label: '새 폴더', value: 'new' }, { label: '새 메모', value: 'note' }]);
    if (a === 'new') newFolder(); else if (a === 'note') newNote();
    return;
  }
  const f = store.getFolder(ui.folderId); if (!f) return;
  const acts = [{ label: '이름 변경', value: 'rename' }, { label: '공유 링크 만들기', value: 'share' }];
  if (!f.shared) acts.push({ label: '폴더 삭제', value: 'delete', danger: true });
  const a = await actionSheet(f.name, acts);
  if (a === 'rename') {
    const name = await promptDialog('폴더 이름 변경', f.name, { ok: '저장' });
    if (name && name.trim()) store.renameFolder(f.id, name.trim());
  } else if (a === 'share') {
    shareFolder(f);
  } else if (a === 'delete') {
    if (await confirmDialog(`'${f.name}' 폴더를 삭제할까요? 안의 메모는 '최근 삭제된 항목'으로 이동합니다.`, { ok: '삭제', danger: true })) {
      store.deleteFolder(f.id); ui.folderId = 'all'; renderAll();
    }
  }
}

async function shareFolder(f) {
  if (!sync.enabled()) { await alertDialog('폴더 공유는 동기화(Supabase)를 연결해야 쓸 수 있습니다. 설정 화면의 안내를 확인하세요.'); openSettings(); return; }
  if (!sync.user()) { toast('먼저 로그인하세요'); openSettings(); return; }
  let url = '';
  try {
    toast('공유 링크를 만드는 중…');
    url = await sync.createShareLink(f.id);
    store.setLocal('folders', f.id, { linked: true });
    if (navigator.share) {
      try { await navigator.share({ title: f.name, text: `'${f.name}' 폴더를 함께 써요`, url }); return; }
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

async function noteMenu() {
  const n = store.getNote(ui.noteId); if (!n) return;
  if (n.deleted) {
    const a = await actionSheet(null, [{ label: '복구', value: 'restore' }, { label: '영구 삭제', value: 'purge', danger: true }]);
    if (a === 'restore') { store.restoreNote(n.id); openNote(n.id, { keepView: true }); toast('복구했습니다'); }
    if (a === 'purge' && await confirmDialog('이 메모를 영구 삭제할까요? 되돌릴 수 없습니다.', { ok: '영구 삭제', danger: true })) { store.purgeNote(n.id); leaveEditor(); }
    return;
  }
  const a = await actionSheet(null, [
    { label: n.pinned ? '고정 해제' : '맨 위에 고정', value: 'pin' },
    { label: '다른 폴더로 이동', value: 'move' },
    { label: '텍스트로 내보내기', value: 'export' },
    { label: '삭제', value: 'delete', danger: true },
  ]);
  if (a === 'pin') store.updateNote(n.id, { pinned: !n.pinned });
  else if (a === 'move') {
    const fs = store.listFolders().filter((f) => f.id !== n.folder_id);
    if (!fs.length) { toast('이동할 다른 폴더가 없습니다'); return; }
    const to = await actionSheet('이동할 폴더', fs.map((f) => ({ label: f.name, value: f.id })));
    if (to) { store.updateNote(n.id, { folder_id: to }); toast('이동했습니다'); }
  } else if (a === 'export') {
    const md = store.toMarkdown(n);
    if (navigator.share && isMobile()) { try { await navigator.share({ title: n.title || '메모', text: md }); } catch { /* 취소 */ } }
    else download(`${(n.title || '메모').replace(/[\\/:*?"<>|]/g, '_')}.md`, md, 'text/markdown');
  } else if (a === 'delete') {
    store.trashNote(n.id); leaveEditor(); toast("'최근 삭제된 항목'으로 이동했습니다");
  }
}

// ---------- 설정 ----------
function openSettings() {
  const box = el('div', {});
  const draw = () => {
    box.textContent = '';
    box.append(el('h4', {}, '동기화'));
    if (!sync.enabled()) {
      box.append(el('p', { class: 'note-text' }, '지금은 이 기기에만 저장됩니다. config.js에 Supabase 주소와 키를 넣으면 로그인 후 컴퓨터와 아이폰이 같은 메모를 보고, 폴더 공유도 켜집니다. 방법은 README에 있습니다.'));
    } else if (!sync.user()) {
      const email = el('input', { type: 'email', placeholder: '이메일', autocomplete: 'email', inputmode: 'email' });
      const pw = el('input', { type: 'password', placeholder: '비밀번호 (6자 이상)', autocomplete: 'current-password' });
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
        el('button', { class: 'btn', type: 'button', onclick: importAll }, '백업 가져오기'))),
      el('p', { class: 'note-text' }, '아이폰: Safari에서 이 페이지를 열고 공유 버튼 → "홈 화면에 추가"를 누르면 앱처럼 열립니다.'));
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
    try { const c = store.importData(JSON.parse(await file.text())); toast(`메모 ${c}개를 가져왔습니다`); }
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
    selectFolder(fid);
    toast('공유 폴더에 참여했습니다');
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
  setTimeout(() => { if (!sync.user()) { toast('공유 폴더에 참여하려면 로그인하세요'); openSettings(); } }, 1200);
}

// ---------- 시작 ----------
function bind() {
  $('#btn-new-note').addEventListener('click', newNote);
  $('#btn-new-folder').addEventListener('click', newFolder);
  $('#btn-folder-menu').addEventListener('click', folderMenu);
  $('#btn-note-menu').addEventListener('click', noteMenu);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#sync-status').addEventListener('click', openSettings);
  $('#btn-restore').addEventListener('click', () => {
    if (!ui.noteId) return;
    store.restoreNote(ui.noteId); openNote(ui.noteId, { keepView: true }); toast('복구했습니다');
  });
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderNotes(); });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.back === 'notes') leaveEditor(); else setView('folders');
  }));
  $('#editor-wrap').addEventListener('click', (e) => {
    if (['editor-wrap', 'editor', 'blocks'].includes(e.target.id)) editor.focusEnd();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyN') { e.preventDefault(); newNote(); }
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

function init() {
  app.dataset.view = ui.view;
  bind();
  renderAll();
  const n = ui.noteId && store.getNote(ui.noteId);
  if (n) openNote(n.id, { keepView: true });
  else { ui.noteId = null; showEditor(null); if (ui.view === 'editor') setView('notes'); }
  if (!isMobile() && !n) {
    const first = store.listNotes(ui.folderId)[0];
    if (first) openNote(first.id, { keepView: true });
  }
  captureJoinParam();
  sync.init({ onStatus, onUser });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
