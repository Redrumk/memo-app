# 앱 파일 + 가짜 Supabase API를 함께 제공하는 테스트 서버
import json, sys, uuid, os, threading, datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
APP = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
lock = threading.Lock()
db = {'folders': {}, 'notes': {}, 'members': set(), 'links': {}, 'images': {}}
def server_now(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def pg_time(v): return v.replace('Z', '+00:00') if isinstance(v, str) else v
def norm(v): return v.replace('+00:00', 'Z') if isinstance(v, str) else v
def can_access(uid, fid):
    f = db['folders'].get(fid)
    return bool(f) and (f['owner_id'] == uid or (fid, uid) in db['members'])
def note_visible(uid, n): return n['owner_id'] == uid or (n.get('folder_id') and can_access(uid, n['folder_id']))
def err(msg): return {'data': None, 'error': {'message': msg, 'code': '42501'}}
def query(q):
    uid, t, op = q.get('uid'), q['table'], q['op']
    if not uid: return err('not authenticated')
    if t in ('folders', 'notes') and op == 'select':
        rows = [r for r in db[t].values() if (can_access(uid, r['id']) if t == 'folders' else note_visible(uid, r))]
        for f in q['filters']:
            if f[0] == 'gte': rows = [r for r in rows if norm(r[f[1]]) >= norm(f[2])]
            if f[0] == 'in': rows = [r for r in rows if r[f[1]] in f[2]]
        if q.get('head'): return {'data': None, 'error': None, 'count': len(rows)}
        return {'data': [{**r, 'created_at': pg_time(r['created_at']), 'updated_at': pg_time(r['updated_at'])} for r in rows], 'error': None}
    if t == 'folders' and op == 'upsert':
        for r in q['rows']:
            ex = db['folders'].get(r['id'])
            if ex:
                if not can_access(uid, r['id']): return err('rls folders update')
                new = {**ex, **r}
                if new.get('deleted') and not ex.get('deleted') and ex['owner_id'] != uid: return err('new row violates row-level security policy for table "folders"')
                if ex.get('deleted') and not new.get('deleted') and ex['owner_id'] != uid: new['deleted'] = True
                new['updated_at'] = server_now()
                db['folders'][r['id']] = new
            else:
                db['folders'][r['id']] = {**r, 'owner_id': uid, 'updated_at': server_now()}
        return {'data': [{'id': r['id'], 'updated_at': pg_time(db['folders'][r['id']]['updated_at'])} for r in q['rows']] if q.get('returning') else None, 'error': None}
    if t == 'notes' and op == 'upsert':
        for r in q['rows']:
            ex = db['notes'].get(r['id'])
            if ex:
                if not note_visible(uid, ex): return err('rls notes update')
                new = {**ex, **r}
                if new.get('folder_id') and not can_access(uid, new['folder_id']) and new['owner_id'] != uid: return err('rls notes update')
                db['notes'][r['id']] = {**new, 'updated_at': server_now()}
            else:
                if r.get('folder_id') and not can_access(uid, r['folder_id']): return err('rls notes insert')
                db['notes'][r['id']] = {**r, 'owner_id': uid, 'updated_at': server_now()}
        return {'data': [{'id': r['id'], 'updated_at': pg_time(db['notes'][r['id']]['updated_at'])} for r in q['rows']] if q.get('returning') else None, 'error': None}
    if t == 'images' and op == 'upsert':
        for r in q['rows']:
            if r['id'] not in db['images']: db['images'][r['id']] = {**r, 'owner_id': uid}
        return {'data': None, 'error': None}
    if t == 'images' and op == 'select':
        ids = next((f[2] for f in q['filters'] if f[0] == 'in'), [])
        out = []
        for i in ids:
            im = db['images'].get(i)
            if not im: continue
            n = db['notes'].get(im.get('note_id'))
            if im['owner_id'] == uid or (n and note_visible(uid, n)): out.append({'id': im['id'], 'data': im['data']})
        return {'data': out, 'error': None}
    if t == 'notes' and op == 'delete':
        ids = next((f[2] for f in q['filters'] if f[0] == 'in'), [])
        for i in ids:
            n = db['notes'].get(i)
            if n and note_visible(uid, n): del db['notes'][i]
        return {'data': None, 'error': None}
    if t == 'folder_members' and op == 'delete':
        fv = {f[1]: f[2] for f in q['filters'] if f[0] == 'eq'}
        key = (fv.get('folder_id'), fv.get('user_id'))
        f = db['folders'].get(key[0])
        if key[1] == uid or (f and f['owner_id'] == uid): db['members'].discard(key)
        return {'data': None, 'error': None}
    if t == 'share_links' and op == 'insert':
        fid = q['rows'][0]['folder_id']; f = db['folders'].get(fid)
        if not f or f['owner_id'] != uid: return err('only owner')
        tok = uuid.uuid4().hex; db['links'][tok] = fid
        return {'data': {'token': tok}, 'error': None}
    return err(f'unsupported {t} {op}')
def rpc(q):
    if q['name'] == 'join_share':
        fid = db['links'].get(q['args']['t'])
        if not fid: return {'data': None, 'error': {'message': '유효하지 않은 공유 링크입니다'}}
        db['members'].add((fid, q['uid'])); return {'data': fid, 'error': None}
    return err('unknown rpc')
class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=APP, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/config.js': return self.send_text("export const CONFIG = { supabaseUrl: 'https://fake.local', supabaseAnonKey: 'fake' };", 'text/javascript')
        if p == '/src/vendor/supabase.js': return self.send_text(open(os.path.join(HERE, 'fake_supabase.js')).read(), 'text/javascript')
        if p == '/fake/dump':
            with lock: return self.send_text(json.dumps({'folders': list(db['folders'].values()), 'notes': list(db['notes'].values()), 'members': [list(m) for m in db['members']], 'images': list(db['images'].keys())}), 'application/json')
        return super().do_GET()
    def send_text(self, s, ct):
        b = s.encode(); self.send_response(200); self.send_header('content-type', ct + '; charset=utf-8'); self.send_header('content-length', str(len(b))); self.send_header('cache-control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        with lock: out = query(body) if self.path == '/fake/query' else rpc(body)
        self.send_text(json.dumps(out), 'application/json')
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
