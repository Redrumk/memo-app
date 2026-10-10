import subprocess, time, sys, json, urllib.request, datetime
from playwright.sync_api import sync_playwright
PORT=5711; BASE=f'http://localhost:{PORT}/'
srv = subprocess.Popen([sys.executable,'server.py',str(PORT)])
time.sleep(1); errs=[]
def ok(c,m): print(('PASS ' if c else 'FAIL ')+m)
def dump(): return json.loads(urllib.request.urlopen(BASE+'fake/dump').read())
ST="const s=await import('/src/store.js');"; SY="const y=await import('/src/sync.js');"
def ev(pg, body, arg=None): return pg.evaluate(f"async(a)=>{{{ST}{SY}{body}}}", arg)
def login(pg, email): ev(pg, "await y.signIn(a,'pw');", email); pg.wait_for_timeout(900)
def sync(pg): ev(pg, "await y.syncNow();"); pg.wait_for_timeout(150)
def page_with(pg, title): return ev(pg, "return s.allPages().find(n=>n.title===a)||null;", title)
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    def dev(clock=None):
        c=br.new_context(viewport={'width':1280,'height':820}); pg=c.new_page()
        if clock: pg.clock.install(time=clock)
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_timeout(700); return c,pg
    ca,A=dev(); cb,B=dev()
    login(A,'one@x.com'); sync(A); login(B,'one@x.com'); sync(B)
    # 1. 사진 동기화
    pid=ev(A,"const n=s.createNote(s.listFolders()[0].id); const r=await s.putImage(a); s.updateNote(n.id,{title:'사진',blocks:[{id:'b1',type:'image',...r}]}); return n.id;",PNG)
    sync(A); sync(B)
    img=ev(B,"const n=s.getNote(a); const b=n&&n.blocks.find(x=>x.type==='image'); return b? (await s.imageURL(b.img)).slice(0,14):'';",pid)
    ok(img=='data:image/png','photo added on A appears on B')
    # 2. 예전 방식 사진 (동기화된 페이지 안 src)
    lid=ev(A,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'옛 사진',blocks:[{id:'L',type:'image',src:a}]}); return n.id;",PNG)
    sync(A); sync(B)
    A.reload(); A.wait_for_timeout(1200); sync(A); B.reload(); B.wait_for_timeout(1200); sync(B)
    ia=ev(A,"return s.getNote(a).blocks[0].img||'';",lid); ib=ev(B,"return s.getNote(a).blocks[0].img||'';",lid)
    hb=ev(B,"return (await s.imageURL(s.getNote(a).blocks[0].img||'x')).slice(0,14);",lid)
    ok(ia and ia==ib and hb=='data:image/png','legacy inline photo survives on both devices after migration')
    # 3. 지우고 로그아웃: 미전송분 있으면 막음
    cb.set_offline(True); ev(B,"s.updateNote(a,{title:'오프라인 수정'});",pid)
    msg=ev(B,"try{ await y.signOut(true); return 'signed out'; }catch(e){ return e.message; }")
    ok('지우지 않았습니다' in msg and page_with(B,'오프라인 수정') is not None,'wipe sign-out refuses while changes are unsent')
    cb.set_offline(False); B.wait_for_timeout(400); sync(B); sync(A)
    # 4. 지워진 섹션에 오프라인으로 만든 페이지
    fid=ev(A,"const f=s.createFolder('임시 섹션'); return f.id;"); sync(A); sync(B)
    cb.set_offline(True); ev(B,"const n=s.createNote(a); s.updateNote(n.id,{title:'살아남을 페이지'});",fid)
    ev(A,"s.deleteFolder(a);",fid); sync(A)
    cb.set_offline(False); B.wait_for_timeout(300); sync(B); sync(B); sync(A)
    na=page_with(A,'살아남을 페이지'); nb=page_with(B,'살아남을 페이지')
    vis=lambda pg,n: ev(pg,"const f=s.getFolder(a); return !!f && !f.deleted;", n['folder_id']) if n else False
    ok(na and nb and not na['deleted'] and vis(A,na) and vis(B,nb),'page made offline in a deleted section stays visible (moved to another section)')
    # 5. 섹션 이름 동시 변경 → 두 기기 일치
    f0=ev(A,"return s.listFolders()[0].id;")
    cb.set_offline(True); ev(B,"s.renameFolder(a,'B 이름');",f0)
    ev(A,"s.renameFolder(a,'A 이름');",f0); sync(A)
    cb.set_offline(False); B.wait_for_timeout(300); sync(B); sync(A); sync(B)
    na=ev(A,"return s.getFolder(a).name;",f0); nb=ev(B,"return s.getFolder(a).name;",f0); sv=[f for f in dump()['folders'] if f['id']==f0][0]['name']
    ok(na==nb==sv,f'concurrent section rename converges ({na}/{nb}/{sv})')
    # 6. 페이지 이동 vs 내용 수정
    rid=ev(A,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'부모'}); return n.id;")
    qid=ev(A,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'옮길 페이지'}); return n.id;")
    sync(A); sync(B)
    cb.set_offline(True); ev(B,"const n=s.getNote(a); s.updateNote(a,{blocks:[{id:'x',type:'p',text:'B가 쓴 내용'}]});",qid)
    ev(A,"s.moveUnder(a.q,a.r);",{'q':qid,'r':rid}); sync(A)
    cb.set_offline(False); B.wait_for_timeout(300); sync(B); sync(A)
    srvq=[n for n in dump()['notes'] if n['id']==qid][0]
    copies=[n for n in dump()['notes'] if '(다른 기기 버전)' in (n.get('title') or '') and '옮길' in n.get('title','')]
    ok(srvq.get('parent_id')==rid and srvq['blocks'][0]['text']=='B가 쓴 내용' and not copies,'move on A + edit on B: both kept, no copy')
    # 7. 공유 섹션 나간 뒤에도 동기화 계속
    sfid=ev(A,"const f=s.createFolder('공유'); const n=s.createNote(f.id); s.updateNote(n.id,{title:'공유글'}); return f.id;"); sync(A)
    url=ev(A,"return await y.createShareLink(a);",sfid)
    cc,C=dev(); login(C,'two@x.com'); C.goto(url); C.wait_for_timeout(1800); sync(C)
    sid=page_with(C,'공유글')['id']
    cc.set_offline(True); ev(C,"s.updateNote(a,{title:'공유글 친구'});",sid); cc.set_offline(False); C.wait_for_timeout(200)
    ev(C,"await y.leaveFolder(a);",sfid)
    ev(C,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'친구 개인'});"); sync(C)
    st=C.locator('#sync-status').get_attribute('data-state'); has=[n for n in dump()['notes'] if n.get('title')=='친구 개인']
    ok(st=='synced' and has,f'after leaving a shared section, sync keeps working (status={st})')
    # 8. 멤버가 지워진 섹션 되살리기 불가
    cc2,D=dev(); login(D,'three@x.com'); url2=ev(A,"return await y.createShareLink(a);",sfid); D.goto(url2); D.wait_for_timeout(1800); sync(D)
    cd=cc2; cd.set_offline(True); ev(D,"s.renameFolder(a,'친구가 바꾼 이름');",sfid)
    ev(A,"s.deleteFolder(a);",sfid); sync(A)
    cd.set_offline(False); D.wait_for_timeout(300); sync(D)
    ok([f for f in dump()['folders'] if f['id']==sfid][0].get('deleted'),'member cannot bring back a section the owner deleted')
    # 9. 시계가 5분 늦은 기기
    slow=datetime.datetime.now()-datetime.timedelta(minutes=5)
    ce,E=dev(clock=slow); login(E,'one@x.com'); sync(E)
    ev(E,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'느린 시계 페이지'});"); sync(E)
    sync(A)
    ok(page_with(A,'느린 시계 페이지') is not None,'page from a device with a slow clock arrives on the next normal sync')
    # 10. 탭 두 개
    A2=ca.new_page(); A2.goto(BASE); A2.wait_for_timeout(900)
    ok(A2.locator('#tab-blocker').count()==1,'second tab is told Memo is open elsewhere')
    A2.click('#tab-blocker button'); A2.wait_for_timeout(1500)
    ok(A.locator('#tab-blocker').count()==1 and A2.locator('#tab-blocker').count()==0,'"open here" moves editing to the new tab')
    br.close()
finally: srv.terminate()
print('ERRORS',errs)
