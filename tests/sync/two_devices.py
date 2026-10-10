import subprocess, time, sys, json, urllib.request
from playwright.sync_api import sync_playwright
PORT=5701; BASE=f'http://localhost:{PORT}/'
srv = subprocess.Popen([sys.executable,'server.py',str(PORT)])
time.sleep(1); errs=[]
def ok(c,m): print(('PASS ' if c else 'FAIL ')+m)
def dump(): return json.loads(urllib.request.urlopen(BASE+'fake/dump').read())
ST="const s=await import('/src/store.js');"; SY="const y=await import('/src/sync.js');"
def ev(pg, body, arg=None): return pg.evaluate(f"async(a)=>{{{ST}{SY}{body}}}", arg)
def login(pg, email): ev(pg, "await y.signIn(a,'pw');", email); pg.wait_for_timeout(900)
def sync(pg): ev(pg, "await y.syncNow();"); pg.wait_for_timeout(200)
def titles(pg): return ev(pg, "return s.allPages().map(n=>n.title);")
def page_with(pg, title): return ev(pg, "return s.allPages().find(n=>n.title===a)||null;", title)
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    def dev():
        c=br.new_context(viewport={'width':1280,'height':820}); pg=c.new_page()
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_timeout(700); return c,pg
    ca,A=dev(); cb,B=dev(); cc,C=dev()
    # 1. 첫 기기 로그인 → 업로드
    login(A,'one@x.com'); sync(A)
    d=dump(); ok(len(d['notes'])==3 and len(d['folders'])==1,f"device A uploads its pages ({len(d['notes'])} notes, {len(d['folders'])} folders)")
    # 2. 두 번째 기기 첫 로그인 → 데모 중복 없음
    login(B,'one@x.com'); sync(B)
    t=titles(B); fcount=ev(B,"return s.listFolders().length;")
    print('B titles',t); ok(t.count('Memo 둘러보기')==1 and fcount==1,'device B first login: no duplicate demo pages or sections')
    ok(len(dump()['notes'])==3,'server still has 3 pages (nothing duplicated)')
    # 3. A에서 고친 내용이 B로
    top=page_with(A,'Memo 둘러보기')['id']
    ev(A,"s.updateNote(a,{title:'여행 계획'});",top); sync(A); sync(B)
    ok(page_with(B,'여행 계획') is not None,'edit on A appears on B (incremental sync)')
    # 4. 동시 편집 → 아무것도 사라지지 않음
    cb.set_offline(True)
    ev(B,"s.updateNote(a,{title:'여행 계획 B'});",top)
    ev(A,"s.updateNote(a,{title:'여행 계획 A'});",top); sync(A)
    cb.set_offline(False); B.wait_for_timeout(300); sync(B); B.wait_for_timeout(300)
    t=titles(B); print('B after conflict',t)
    ok('여행 계획 B' in t and '여행 계획 A (다른 기기 버전)' in t,'conflict: B keeps its edit and saves A\'s version as a copy')
    toast=B.locator('#toast').inner_text() if B.locator('#toast').count() else ''
    ok('다른 기기 버전' in toast,'user is told about the saved copy')
    sync(B); sync(A); t=titles(A)
    ok('여행 계획 B' in t and '여행 계획 A (다른 기기 버전)' in t,'A ends with both versions too')
    # 5. 영구 삭제 전파
    gid=page_with(A,'블록 사용법')['id']
    ev(A,"s.trashNote(a); s.purgeNote(a);",gid); sync(A)
    B.reload(); B.wait_for_timeout(1200); sync(B)
    ok(page_with(B,'블록 사용법') is None,'permanent delete on A removes page on B')
    # 6. 공유
    fid=ev(A,"const f=s.createFolder('함께'); const n=s.createNote(f.id); s.updateNote(n.id,{title:'공유 페이지'}); return f.id;"); sync(A)
    url=ev(A,"return await y.createShareLink(a);",fid)
    login(C,'two@x.com'); sync(C)
    C.goto(url); C.wait_for_timeout(1800); sync(C)
    ok(page_with(C,'공유 페이지') is not None,'friend joins via share link and sees the shared section')
    ok(ev(C,"return !!s.getFolder(a).shared;",fid),'section marked as shared for friend')
    sid=page_with(C,'공유 페이지')['id']
    ev(C,"s.updateNote(a,{title:'공유 페이지 (친구 수정)'});",sid); sync(C); sync(A)
    ok(page_with(A,'공유 페이지 (친구 수정)') is not None,"friend's edit reaches the owner")
    r=ev(C,"const {createClient}=await import('/src/vendor/supabase.js'); return await createClient().from('folders').upsert([{id:a,deleted:true}]);",fid)
    ok(r['error'] is not None and not [f for f in dump()['folders'] if f['id']==fid][0].get('deleted'),'friend cannot delete the shared section (server rule)')
    # 7. 계정 전환: 취소
    ev(B,"await y.signOut(false);"); B.wait_for_timeout(300)
    login(B,'two@x.com'); B.wait_for_timeout(300)
    ok(B.locator('.dialog-msg').count()==1,'switching account on a device asks first')
    B.click('.dialog .btn:has-text("로그인 취소")'); B.wait_for_timeout(600)
    ok(page_with(B,'여행 계획 B') is not None and not ev(B,"return !!y.user();"),'cancel keeps this device\'s pages and stays signed out')
    # 계정 전환: 지우고 로그인
    login(B,'two@x.com'); B.click('.dialog .btn:has-text("지우고 로그인")'); B.wait_for_timeout(1500); sync(B)
    t=titles(B); print('B as user2',t)
    ok('여행 계획 B' not in t and '공유 페이지 (친구 수정)' in t,"after switching, user1's private pages are gone and user2's pages arrive")
    # 8. 오프라인에서 열기
    A.wait_for_timeout(1500); ca.set_offline(True); A.reload(); A.wait_for_timeout(1500)
    st=A.locator('#sync-status').get_attribute('data-state')
    ok(A.locator('.tree-row').count()>0 and st!='error',f'app opens offline with pages (status={st})')
    br.close()
finally: srv.terminate()
print('ERRORS',errs)
