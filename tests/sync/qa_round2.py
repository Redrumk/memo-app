# QA 2차 검수에서 찾은 문제 재현 (jsonb 키 순서, 공유 끊김 페이지, 공유 섹션 사진, 데이터 없는 사진, 탭 잠금)
import subprocess, time, sys, json, urllib.request
from playwright.sync_api import sync_playwright
PORT=5721; BASE=f'http://localhost:{PORT}/'
srv = subprocess.Popen([sys.executable,'server.py',str(PORT)])
time.sleep(1); errs=[]
def ok(c,m): print(('PASS ' if c else 'FAIL ')+m)
def dump(): return json.loads(urllib.request.urlopen(BASE+'fake/dump').read())
ST="const s=await import('/src/store.js');"; SY="const y=await import('/src/sync.js');"
def ev(pg, body, arg=None): return pg.evaluate(f"async(a)=>{{{ST}{SY}{body}}}", arg)
def login(pg, email): ev(pg, "await y.signIn(a,'pw');", email); pg.wait_for_timeout(900)
def sync(pg): ev(pg, "await y.syncNow();"); pg.wait_for_timeout(150)
def page_with(pg, title): return ev(pg, "return s.allPages().find(n=>n.title===a)||null;", title)
def copies(): return [n for n in dump()['notes'] if '(다른 기기 버전)' in (n.get('title') or '')]
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    def dev():
        c=br.new_context(viewport={'width':1280,'height':820}); pg=c.new_page()
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.goto(BASE); pg.wait_for_timeout(700); return c,pg
    ca,A=dev(); cb,B=dev()
    login(A,'one@x.com'); sync(A); login(B,'one@x.com'); sync(B)
    # 1. jsonb 키 순서: 이동/즐겨찾기 vs 본문 수정 → 사본 없음
    rid=ev(A,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'부모'}); return n.id;")
    qid=ev(A,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'옮길',blocks:[{id:'a1',type:'todo',text:'할 일',checked:false}]}); return n.id;")
    sync(A); sync(B)
    ev(B,"s.moveUnder(a.q,a.r);",{'q':qid,'r':rid}); sync(B)
    ca.set_offline(True); ev(A,"s.updateNote(a,{blocks:[{id:'a1',type:'todo',text:'할 일 수정',checked:true}]});",qid)
    ca.set_offline(False); A.wait_for_timeout(300); sync(A); sync(B)
    q=[n for n in dump()['notes'] if n['id']==qid][0]
    ok(not copies() and q.get('parent_id')==rid and q['blocks'][0]['text']=='할 일 수정','move + edit with server key reordering: merged, no copy')
    ev(A,"s.updateNote(a,{pinned:true});",qid); sync(A)
    cb.set_offline(True); ev(B,"s.updateNote(a,{title:'옮김(제목 수정)'});",qid); cb.set_offline(False); B.wait_for_timeout(300); sync(B); sync(A)
    q=[n for n in dump()['notes'] if n['id']==qid][0]
    ok(not copies() and q.get('pinned') and q['title']=='옮김(제목 수정)','favorite on A + title edit on B: merged, no copy')
    # 2. 같은 계정 다른 기기가 공유 섹션을 나가도 오프라인에서 만든 페이지 보존
    sfid=ev(A,"const f=s.createFolder('공유'); const n=s.createNote(f.id); s.updateNote(n.id,{title:'공유글'}); return f.id;"); sync(A)
    url=ev(A,"return await y.createShareLink(a);",sfid)
    cc,C=dev(); login(C,'two@x.com'); C.goto(url); C.wait_for_timeout(1800); sync(C)
    cd,D=dev(); login(D,'two@x.com'); sync(D)
    cc.set_offline(True); ev(C,"const n=s.createNote(a); s.updateNote(n.id,{title:'C의 오프라인 페이지'});",sfid)
    ev(D,"await y.leaveFolder(a);",sfid)
    cc.set_offline(False); C.wait_for_timeout(300); sync(C); sync(C)
    kept=[n for n in dump()['notes'] if n.get('title')=='C의 오프라인 페이지']
    ok(page_with(C,'C의 오프라인 페이지') is not None and kept,"page made offline survives when another device of the same account left the section")
    # 3. 복제해서 공유 섹션으로 옮긴 페이지의 사진이 친구에게 보임
    sf2=ev(A,"const f=s.createFolder('공유2'); return f.id;"); sync(A)
    url2=ev(A,"return await y.createShareLink(a);",sf2)
    ce,E=dev(); login(E,'three@x.com'); E.goto(url2); E.wait_for_timeout(1800)
    pid=ev(A,"const n=s.createNote(s.listFolders().find(f=>f.name!=='공유'&&f.name!=='공유2').id); const r=await s.putImage(a); s.updateNote(n.id,{title:'사진 원본',blocks:[{id:'i1',type:'image',...r}]}); return n.id;",PNG)
    sync(A)
    ev(A,"const c=s.duplicateNote(a.p); s.moveNote(c.id,a.f); s.updateNote(c.id,{title:'공유 사본'});",{'p':pid,'f':sf2}); sync(A); sync(E)
    img=ev(E,"const n=s.allPages().find(x=>x.title==='공유 사본'); const b=n&&n.blocks.find(x=>x.type==='image'); return b?(await s.imageURL(b.img)).slice(0,14):'';")
    ok(img=='data:image/png','photo in a page copied into a shared section is visible to the friend')
    # 4. 데이터 없는 사진이 있어도 지우고 로그아웃 가능
    ev(B,"const n=s.createNote(s.listFolders()[0].id); s.updateNote(n.id,{title:'깨진 사진',blocks:[{id:'z',type:'image',img:'img_doesnotexist'}]});")
    msg=ev(B,"try{ await y.signOut(true); return 'ok'; }catch(e){ return e.message; }")
    ok(msg=='ok','a photo with no data does not block wipe sign-out')
    # 5. 탭 잠금 (Web Locks)
    A2=ca.new_page(); A2.goto(BASE); A2.wait_for_timeout(900)
    ok(A2.locator('#tab-blocker').count()==1,'second tab is blocked')
    A2.click('#tab-blocker button'); A2.wait_for_timeout(1800)
    ok(A.locator('#tab-blocker').count()==1 and A2.locator('#tab-blocker').count()==0,'taking over moves editing to the new tab and stops the old one')
    A.click('#tab-blocker button'); A.wait_for_timeout(1800)
    ok(A2.locator('#tab-blocker').count()==1 and A.locator('#tab-blocker').count()==0,'and back again')
    br.close()
finally: srv.terminate()
print('ERRORS',errs)
