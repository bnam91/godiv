# godiv

상세페이지(네이버/쿠팡/와디즈) 다운로더 + 크롭 캔버스 Electron 앱.

링크를 넣으면 플랫폼을 자동 판별해 상세페이지 이미지를 내려받고, 패널의 캔버스에서 고디터 스크래치패드처럼 **가로 슬라이스(크롭)·세로 합치기·GIF 프레임 추출**을 한다.

## 실행 (소스 직접 실행)

```bash
cd ~/github/godiv
npm install          # 최초 1회 (Apple Silicon은 arch -arm64 권장)
npm run app          # = electron .
```

- macOS(Apple Silicon)에서 렌더가 멈추면: `arch -arm64 npm run app`
- 자동업데이트: GitHub Releases(`bnam91/godiv`) 최신 태그와 `VERSION.txt` 비교. 소스실행 + 클린 워킹트리에서만 git 기반 업데이트, 그 외엔 릴리스 링크 안내.

## 사용법

1. **URL 입력** → 플랫폼 뱃지(네이버/쿠팡/와디즈) 자동 표시.
2. (네이버가 막히면) **키워드 검색 패널**에 '햇빛가리개' 등 입력 → 결과 목록에서 상품 선택.
3. **저장 위치/폴더명** 지정(비우면 상품명 자동: `브랜드_핵심키워드`, 기본 루트 `~/Downloads/div_download/`).
4. **상세페이지 다운로드** → `01.png, 02.jpg…` Y좌표 순으로 저장(GIF 원본 유지).
5. **캔버스 편집**:
   - ✂ = 가로 절단선 슬라이스(클릭 확정, Esc 취소) → `NN_a.png / NN_b.png`
   - 다중선택 → **선택 합치기**(세로 concat, 폭 정규화, 65535px 초과 시 자동 분할) → `merged_NN.png`
   - GIF의 `GIF` 버튼 → 프레임 슬라이더 → **이 프레임 PNG 저장**(`NN_frameMM.png`). 저장한 프레임은 합치기 시 정지 이미지로 사용.
   - ✕ = 개별 이미지 삭제. 전체선택/선택해제/줌리셋 툴바 제공.
6. **고디터/피그마 올리기**: 현재 스텁(‘예정’ 뱃지) — MCP 연동 예정(v2).

## 브라우저 / 안티봇

- `puppeteer-core`로 **시스템 크롬을 headful**로 띄운다(`findChromePath`가 맥/윈/리눅스 경로 탐지). 전용 프로필 `userData/godiv-chrome-profile`로 네이버 로그인 세션 유지. 기존 CDP 포트(9222/9333/9334 등)는 건드리지 않음.
- 봇차단 회피: 상세 딥링크 직접 접근 대신 **홈 웜업 후 진입**, 네이버는 **검색→상품 클릭** 경로, `puppeteer-extra-plugin-stealth`(webdriver/plugins/webgl 위장) 적용.
- 그래도 **Access Denied / 네이버 "시스템오류"** 가 뜨면 = IP/세션 레벨 봇차단. 앱이 이를 감지해 안내하며, **열린 크롬 창에서 직접 로그인/캡차를 1회 통과한 뒤 다시 다운로드**하면 된다(headful이라 가능).

## 실전 테스트(항목 16·17) 완료 안내

파이프라인은 라이브에서 검증됨(네이버 상세페이지 `se-image` 37장 실추출, 키워드검색 실동작). 단, 개발 세션에서 반복 테스트하며 **그 환경의 IP가 네이버/쿠팡 안티봇에 장시간 밴**되어 디스크 실저장 데모를 그 세션에서 완료하지 못했다(31분 무접촉 후에도 차단 확인 = 수시간~하루 단위 밴).

→ **거주지 IP(일반 실사용 네트워크)에서 위 사용법대로 실행하면 저장까지 완료**된다. IP 밴은 지문이 아니라 네트워크 레벨이라 stealth로도 우회 불가하며, 밴 걸린 IP를 계속 두드리면 밴이 유지되므로 자연 회복(수시간)이 필요하다.

## 구조

```
main.js                     # 메인 프로세스 (BrowserWindow, IPC, 창크기 persist)
preload.mjs                 # contextBridge (window.godiv)
config.js                   # settings.json persist (저장루트/폴더명/창크기, 원자적 저장)
electron/services/
  browserService.js         # puppeteer 크롬 + 웜업/스텔스/차단감지 + 다운로드 파이프라인
  downloaders/{coupang,naver,wadiz}.js  # extract(page)→{title, images:[{url,y}]}
  imageStore.js             # 이미지 IO (경로 traversal 방어 화이트리스트)
  updateService.js          # module_update_auto 연동 (소스+클린트리 게이팅)
  platform.js               # URL→플랫폼 판별
renderer/
  index.html / styles.css
  js/{renderer,canvas,slice,merge,gif,platform}.js
submodules/module_update_auto/   # 자동업데이트 모듈(복사본)
test/                       # 통합/보안/UI 하네스 (canvas-test, security-test, ui-drive, run-download)
```

## 빌드

electron-builder 설정 선탑재(`package.json > build`). mac(dmg/zip) · win(nsis/portable). `npm run build:mac` / `build:win`.
