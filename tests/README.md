# 테스트

## 동기화 (가짜 서버)
실제 Supabase 없이 두 기기·두 계정 상황을 확인합니다.

```bash
pip install playwright   # Chromium 필요
cd tests/sync
python3 two_devices.py      # 기본 시나리오 16개
python3 qa_fixes_sync.py    # QA가 찾은 동기화 버그 재현 11개
```

`server.py`는 앱 파일과 가짜 백엔드(`/fake/*`)를 함께 띄우고, `/config.js`와 `/src/vendor/supabase.js`를 가짜로 바꿔 제공합니다.
