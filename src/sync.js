// Supabase 동기화: config.js가 비어 있으면 아무것도 하지 않는다(로컬 모드).
// 방식: 변경분 업로드 → 전체 내려받기 → 수정 시각이 최신인 쪽 채택. 개인·지인 규모에 맞춘 단순한 구조.
import { CONFIG } from '../config.js';
import * as store from './store.js';

let sb = null;
let currentUser = null;
let syncing = false;
let queued = false;
let timer = null;
let hooks = { onStatus() {}, onUser() {} };

export const enabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const user = () => currentUser;
const status = (s, d) => hooks.onStatus(s, d);

export async function init(h) {
  hooks = { ...hooks, ...h };
  if (!enabled()) { status('local'); return; }
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = mod.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.error(e);
    status('error', '동기화 모듈을 불러오지 못했습니다');
    return;
  }
  const { data } = await sb.auth.getSession();
  setUser(data.session ? data.session.user : null);
  sb.auth.onAuthStateChange((_event, session) => {
    const u = session ? session.user : null;
    // 콜백 안에서 바로 Supabase를 호출하면 잠금이 걸릴 수 있어 다음 틱으로 미룬다
    if ((u && u.id) !== (currentUser && currentUser.id)) setTimeout(() => setUser(u), 0);
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => status('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
}

function setUser(u) {
  currentUser = u;
  hooks.onUser(u);
  if (u) syncNow(); else status('signed-out');
}

export function scheduleSync() {
  if (!sb || !currentUser) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, 2500);
}

const folderRow = (f) => ({ id: f.id, name: f.name, created_at: f.created_at, updated_at: f.updated_at, deleted: !!f.deleted });
const noteRow = (n) => ({
  id: n.id, folder_id: n.folder_id || null, title: n.title || '', blocks: n.blocks || [],
  pinned: !!n.pinned, created_at: n.created_at, updated_at: n.updated_at, deleted: !!n.deleted,
});

export async function syncNow() {
  if (!sb || !currentUser) return;
  if (syncing) { queued = true; return; }
  if (!navigator.onLine) { status('offline'); return; }
  syncing = true;
  status('syncing');
  try {
    const d = store.dirtyItems();
    if (d.folders.length) {
      const { error } = await sb.from('folders').upsert(d.folders.map(folderRow));
      if (error) throw error;
      store.markClean('folders', d.folders);
    }
    if (d.notes.length) {
      const { error } = await sb.from('notes').upsert(d.notes.map(noteRow));
      if (error) throw error;
      store.markClean('notes', d.notes);
    }
    if (d.purged.length) {
      const { error } = await sb.from('notes').delete().in('id', d.purged);
      if (error) throw error;
      store.clearPurged(d.purged);
    }
    const [f, n] = await Promise.all([sb.from('folders').select('*'), sb.from('notes').select('*')]);
    if (f.error) throw f.error;
    if (n.error) throw n.error;
    store.mergeRemote(f.data, n.data, currentUser.id);
    status('synced', new Date());
  } catch (e) {
    console.error(e);
    status('error', e.message || String(e));
  } finally {
    syncing = false;
    if (queued) { queued = false; setTimeout(syncNow, 500); }
  }
}

async function waitIdle() {
  while (syncing) await new Promise((r) => setTimeout(r, 150));
}

function localizeAuth(e) {
  const m = (e && e.message) || '';
  if (/Invalid login/i.test(m)) return new Error('이메일 또는 비밀번호가 맞지 않습니다');
  if (/already registered/i.test(m)) return new Error('이미 가입된 이메일입니다. 로그인하세요');
  if (/Email not confirmed/i.test(m)) return new Error('메일 인증이 아직 안 됐습니다. 받은 메일의 링크를 눌러주세요');
  if (/Password should be/i.test(m)) return new Error('비밀번호는 6자 이상이어야 합니다');
  return e;
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw localizeAuth(error);
  return '로그인했습니다';
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw localizeAuth(error);
  return data.session ? '가입하고 로그인했습니다' : '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요.';
}
export async function signOut() {
  await sb.auth.signOut();
}

export async function createShareLink(folderId) {
  await waitIdle();
  await syncNow(); // 폴더가 서버에 먼저 있어야 링크를 만들 수 있다
  const { data, error } = await sb.from('share_links').insert({ folder_id: folderId }).select('token').single();
  if (error) {
    if (error.code === '42501') throw new Error('폴더를 만든 사람만 공유 링크를 만들 수 있습니다');
    throw error;
  }
  return `${location.origin}${location.pathname}?join=${data.token}`;
}

export async function joinShare(token) {
  await waitIdle();
  const { data, error } = await sb.rpc('join_share', { t: token });
  if (error) throw error;
  return data;
}
