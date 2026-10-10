// 테스트용 가짜 Supabase 클라이언트: 앱이 쓰는 부분만 흉내 내고, 데이터는 테스트 서버(/fake)에 둔다
const KEY = 'fakeSession';
const listeners = [];
const getS = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const fire = (ev, s) => listeners.forEach((cb) => cb(ev, s));
async function call(path, body) {
  const s = getS();
  const res = await fetch(`/fake/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, uid: s && s.user.id }) });
  return res.json();
}
class Q {
  constructor(table) { this.q = { table, op: 'select', filters: [] }; }
  select(cols, opts = {}) { if (this.q.op === 'insert' || this.q.op === 'upsert') this.q.returning = true; else { this.q.op = 'select'; this.q.head = !!opts.head; this.q.count = !!opts.count; } return this; }
  upsert(rows, opts) { this.q.op = 'upsert'; this.q.rows = rows; this.q.opts = opts; return this; }
  insert(row) { this.q.op = 'insert'; this.q.rows = [row]; return this; }
  delete() { this.q.op = 'delete'; return this; }
  in(c, v) { this.q.filters.push(['in', c, v]); return this; }
  eq(c, v) { this.q.filters.push(['eq', c, v]); return this; }
  gte(c, v) { this.q.filters.push(['gte', c, v]); return this; }
  single() { this.q.single = true; return this; }
  then(ok, bad) { return call('query', this.q).then(ok, bad); }
}
export function createClient() {
  return {
    auth: {
      async getSession() { return { data: { session: getS() } }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email }) { const s = { user: { id: `u_${email}`, email } }; localStorage.setItem(KEY, JSON.stringify(s)); fire('SIGNED_IN', s); return { error: null }; },
      async signUp({ email }) { const s = { user: { id: `u_${email}`, email } }; localStorage.setItem(KEY, JSON.stringify(s)); fire('SIGNED_IN', s); return { data: { session: s }, error: null }; },
      async signOut() { localStorage.removeItem(KEY); fire('SIGNED_OUT', null); return { error: null }; },
    },
    from: (t) => new Q(t),
    rpc: (name, args) => call('rpc', { name, args }),
  };
}
