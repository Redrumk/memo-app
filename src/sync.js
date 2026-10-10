// Supabase 동기화: config.js가 비어 있으면 아무것도 하지 않는다(로컬 모드).
// 방식: 바뀐 것 올리기 → 바뀐 것 받기(10분마다, 그리고 앱을 열 때는 전체) → 병합.
// 같은 페이지를 두 기기에서 동시에 고치면 store.mergeRemote가 '다른 기기 버전' 사본을 남긴다.
import { CONFIG } from '../config.js';
import * as store from './store.js';

let sb = null;
let currentUser = null;
let syncing = false;
let queued = false;
let timer = null;
let lastFull = 0;
let hooks = { onStatus() {}, onUser() {}, confirmAccountSwitch: async () => false };

const FULL_EVERY = 10 * 60 * 1000;

export const enabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const user = () => currentUser;
const status = (s, d) => hooks.onStatus(s, d);

export async function init(h) {
  hooks = { ...hooks, ...h };
  if (!enabled()) { status('local'); return; }
  try {
    // 앱 안에 포함한 라이브러리를 쓴다 (오프라인에서도 앱이 열리도록)
    const mod = await import('./vendor/supabase.js');
    sb = mod.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.error(e);
    status('error', '동기화 모듈을 불러오지 못했습니다');
    return;
  }
  const { data } = await sb.auth.getSession();
  await setUser(data.session ? data.session.user : null);
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

async function setUser(u) {
  if (!u) { currentUser = null; hooks.onUser(null); status('signed-out'); return; }
  const owner = store.getMeta('ownerId');
  if (owner && owner !== u.id) {
    // 이 기기에는 다른 계정의 페이지가 있다 → 섞이지 않게 확인
    const wipe = await hooks.confirmAccountSwitch();
    if (!wipe) { await sb.auth.signOut(); currentUser = null; hooks.onUser(null); status('signed-out'); return; }
    await store.resetLocal();
  }
  currentUser = u;
  if (store.getMeta('ownerId') !== u.id) {
    // 이 기기에서 이 계정으로 처음 로그인: 서버에 이미 페이지가 있으면 손대지 않은 데모는 버린다
    try {
      const { count, error } = await sb.from('notes').select('id', { count: 'exact', head: true });
      if (!error && count > 0) store.dropPristineDemo();
    } catch (e) { console.warn(e); }
    store.setMeta('lastPull', null);
    store.setMeta('ownerId', u.id);
  }
  lastFull = 0;
  hooks.onUser(u);
  syncNow();
}

export function scheduleSync() {
  if (!sb || !currentUser) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, 2500);
}

const folderRow = (f) => ({ id: f.id, name: f.name, created_at: f.created_at, updated_at: f.updated_at, deleted: !!f.deleted });
const noteRow = (n) => ({
  id: n.id, folder_id: n.folder_id || null, parent_id: n.parent_id || null, icon: n.icon || '', cover: n.cover || '',
  title: n.title || '', blocks: n.blocks || [],
  pinned: !!n.pinned, created_at: n.created_at, updated_at: n.updated_at, deleted: !!n.deleted,
});

export async function syncNow() {
  if (!sb || !currentUser) return;
  if (syncing) { queued = true; return; }
  if (!navigator.onLine) { status('offline'); return; }
  syncing = true;
  status('syncing');
  try {
    store.bumpStale();
    const d = store.dirtyItems();
    if (d.folders.length) {
      const { error } = await sb.from('folders').upsert(d.folders.map(folderRow));
      if (error) throw error;
      store.markClean('folders', d.folders);
    }
    if (d.notes.length) {
      const known = d.notes.filter((n) => n.baseAt).map((n) => n.id);
      if (known.length) {
        const { data: remote, error: e1 } = await sb.from('notes').select('*').in('id', known);
        if (e1) throw e1;
        store.preserveConflicts(remote);
        store.bumpStale();
      }
      const after = store.dirtyItems().notes; // 사본이 생겼으면 함께 올린다
      const { error } = await sb.from('notes').upsert(after.map(noteRow));
      if (error) throw error;
      store.markClean('notes', after);
    }
    if (d.purged.length) {
      const { error } = await sb.from('notes').delete().in('id', d.purged);
      if (error) throw error;
      store.clearPurged(d.purged);
    }
    const since = store.getMeta('lastPull');
    const full = !since || Date.now() - lastFull > FULL_EVERY;
    let fq = sb.from('folders').select('*');
    let nq = sb.from('notes').select('*');
    if (!full) {
      // 기기 시계 차이를 감안해 2분 겹쳐서 받는다
      const from = new Date(Date.parse(since) - 120000).toISOString();
      fq = fq.gte('updated_at', from); nq = nq.gte('updated_at', from);
    }
    const [f, n] = await Promise.all([fq, nq]);
    if (f.error) throw f.error;
    if (n.error) throw n.error;
    store.mergeRemote(f.data, n.data, currentUser.id, { full });
    if (full) lastFull = Date.now();
    let maxAt = since || '';
    for (const r of [...f.data, ...n.data]) { const t = new Date(r.updated_at).toISOString(); if (t > maxAt) maxAt = t; }
    if (maxAt) store.setMeta('lastPull', maxAt);
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
// wipe=true면 이 기기의 페이지도 지운다 (공용 기기, 계정 정리)
export async function signOut(wipe = false) {
  await waitIdle();
  if (!wipe) await syncNow(); // 남기는 경우에도 마지막 변경은 올려 둔다
  await sb.auth.signOut();
  if (wipe) await store.resetLocal();
}

export async function createShareLink(folderId) {
  await waitIdle();
  await syncNow(); // 폴더가 서버에 먼저 있어야 링크를 만들 수 있다
  const { data, error } = await sb.from('share_links').insert({ folder_id: folderId }).select('token').single();
  if (error) {
    if (error.code === '42501') throw new Error('섹션을 만든 사람만 공유 링크를 만들 수 있습니다');
    throw error;
  }
  return `${location.origin}${location.pathname}?join=${data.token}`;
}

export async function leaveFolder(folderId) {
  await waitIdle();
  const { error } = await sb.from('folder_members').delete().eq('folder_id', folderId).eq('user_id', currentUser.id);
  if (error) throw error;
  lastFull = 0; // 나간 섹션을 지우려면 전체 목록이 필요하다
  await syncNow();
}

export async function joinShare(token) {
  await waitIdle();
  const { data, error } = await sb.rpc('join_share', { t: token });
  if (error) throw error;
  lastFull = 0;
  return data;
}
