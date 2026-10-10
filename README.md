# Memo

아이폰 메모장처럼 바로 쓰고, 노션처럼 폴더·블록으로 정리하는 개인 노트 앱.
컴퓨터와 아이폰에서 같은 메모를 보고, 필요하면 폴더를 지인과 링크로 공유합니다.

## 기능

- 노션식 구조: 왼쪽 사이드바에 섹션 → 페이지 → 하위 페이지가 나무처럼 펼쳐짐, 상단 경로 표시
- 페이지마다 아이콘(이모지)과 커버, 즐겨찾기
- 블록 에디터: 본문, 제목, 소제목, 목록, 번호 목록, 체크리스트, 인용, 콜아웃, 토글, 표, 하위 페이지, 구분선, 이미지
  - 줄 맨 앞에서 `/` → 블록 메뉴 (`/페이지` 로 하위 페이지 생성)
  - 단축 입력: `# ` 제목, `## ` 소제목, `- ` 목록, `1. ` 번호, `[] ` 체크, `> ` 토글, `" ` 인용, `---` 구분선
  - Tab 들여쓰기 / Shift+Tab 내어쓰기 (접힌 토글 아래 내용은 숨겨짐)
  - 컴퓨터: 블록 왼쪽 `⋮⋮` 를 끌어서 순서 변경, 눌러서 블록 메뉴, `+` 로 블록 추가
  - 아이폰: 키보드 위 도구 막대(형식, ↑ ↓ 이동, ⋯ 블록 메뉴)
- 새 페이지 템플릿(할 일, 회의록, 일기, 기획서, 독서 기록), 되돌리기 ↶ (Cmd/Ctrl+Z)
- 표: 정렬, 카드로 보기
- 웹 주소를 붙여넣으면 링크 카드, 페이지를 다른 페이지 안으로 옮기기·순서 바꾸기, 휴대폰 첫 화면에 최근 페이지
- 검색, 복제, 섹션 이동, 휴지통(하위 페이지 포함 복구), 마크다운 내보내기, 전체 백업/가져오기
- 홈 화면에 추가하면 앱처럼 실행, 오프라인에서도 열림
- (선택) Supabase 연결 시: 로그인, 기기 간 동기화, 섹션 공유 링크

빌드 과정이 없습니다. 파일 그대로 정적 호스팅에 올리면 됩니다.

## 구조

```
index.html            화면 뼈대
config.js             Supabase 주소/키 (비우면 로컬 모드)
manifest.webmanifest  홈 화면 앱 설정
sw.js                 오프라인 캐시
src/main.js           화면 흐름 (폴더/목록/편집, 메뉴, 설정)
src/editor.js         블록 에디터
src/store.js          데이터 저장 (이 기기 localStorage)
src/sync.js           Supabase 동기화·로그인·공유
src/ui.js             공용 UI 헬퍼
src/styles.css        스타일 (라이트/다크)
supabase/schema.sql   DB 테이블과 접근 권한(RLS)
```

## 내 컴퓨터에서 실행

```bash
cd memo-app
python3 -m http.server 5173
# 브라우저에서 http://localhost:5173
```

## GitHub에 올리고 웹에 배포 (GitHub Pages)

1. GitHub에서 빈 저장소를 만든다 (예: `memo-app`).
2. 이 폴더를 푸시한다.
   ```bash
   git remote add origin https://github.com/<아이디>/memo-app.git
   git push -u origin main
   ```
3. 저장소 Settings → Pages → Branch: `main`, 폴더 `/ (root)` → Save.
4. 몇 분 뒤 `https://<아이디>.github.io/memo-app/` 에서 열린다.

## 아이폰에 앱처럼 설치

Safari로 위 주소 열기 → 공유 버튼 → "홈 화면에 추가".

## 동기화·공유 켜기 (Supabase, 무료 플랜으로 충분)

1. https://supabase.com 에서 새 프로젝트 생성.
2. SQL Editor에 `supabase/schema.sql` 전체를 붙여넣고 Run.
3. Project Settings → API에서 `Project URL`과 `anon public` 키를 복사해 `config.js`에 넣는다.
4. Authentication → URL Configuration → Site URL을 배포 주소(예: `https://<아이디>.github.io/memo-app/`)로 설정.
   - 가입 확인 메일이 번거로우면 Authentication → Providers → Email → "Confirm email"을 끈다(개인용일 때).
5. 앱의 설정(톱니바퀴)에서 가입/로그인. 컴퓨터와 아이폰에서 같은 계정으로 로그인하면 끝.

공유: 폴더 메뉴(⋯) → "공유 링크 만들기" → 링크 전달. 받은 사람이 링크를 열고 로그인하면 그 폴더가 양쪽에 보이고 함께 편집합니다.

## 동작 방식과 한계

- 모든 메모는 먼저 이 기기에 저장되고, 로그인 상태면 몇 초 뒤 서버로 올라갑니다.
- 같은 메모를 두 기기에서 거의 동시에 고치면 나중에 저장한 쪽이 남습니다(실시간 공동 편집은 의도적으로 제외).
- 이미지는 1600px JPEG로 줄여 메모 안에 저장합니다. 사진이 많아지면 다음 단계에서 Supabase Storage로 옮길 예정.
- 동기화는 매번 전체 목록을 받습니다. 메모가 수천 개가 되면 변경분만 받도록 바꿀 예정.

## 다음 후보

- 이미지 → Supabase Storage
- 공유 폴더 멤버 관리 화면
