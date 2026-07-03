#!/bin/zsh
# IP 쿨다운 후 네이버→쿠팡 실다운로드 1회씩 시도. 결과를 /tmp/godiv_retry_result.txt에 기록.
set -e
cd /Users/a1/github/godiv
RESULT=/tmp/godiv_retry_result.txt
echo "=== cooldown-retry 시작 $(date) ===" > "$RESULT"

# 진행 중인 electron 정리
pkill -f "godiv/node_modules/electron" 2>/dev/null || true

# 1) IP 쿨다운 대기 (40분)
COOLDOWN=${GODIV_COOLDOWN:-2400}
echo "IP 쿨다운 대기 ${COOLDOWN}s..." >> "$RESULT"
sleep "$COOLDOWN"
echo "쿨다운 완료 $(date)" >> "$RESULT"

run_electron () {
  # $1=logfile, 나머지=env는 호출측에서 export
  timeout 150 arch -arm64 npx electron test/run-download.mjs > "$1" 2>&1 || true
  pkill -f "godiv/node_modules/electron" 2>/dev/null || true
  sleep 3
}

# 2) 네이버: 키워드 검색으로 최신 URL 확보
echo "--- 네이버 키워드 검색 ---" >> "$RESULT"
GODIV_TEST_MODE=naver-search GODIV_TEST_KEYWORD="햇빛가리개" run_electron /tmp/godiv_r_ns.log
NURL=$(grep "RESULT_JSON:" /tmp/godiv_r_ns.log | sed 's/.*RESULT_JSON://' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);const it=(r.items||[]).sort((a,b)=>(b.reviewCount||0)-(a.reviewCount||0));process.stdout.write(it[0]?.url||'')}catch(e){}})")
echo "선택 URL: $NURL" >> "$RESULT"

# 3) 네이버 다운로드 (검색→클릭 진입)
if [ -n "$NURL" ]; then
  echo "--- 네이버 다운로드 ---" >> "$RESULT"
  GODIV_TEST_MODE=download GODIV_TEST_PLATFORM=naver GODIV_TEST_URL="$NURL" run_electron /tmp/godiv_r_nd.log
  grep "RESULT_JSON:" /tmp/godiv_r_nd.log | sed 's/.*RESULT_JSON://' >> "$RESULT"
fi

# 4) 쿠팡 다운로드 (웜업 강화 — 홈 체류 후 딥링크)
echo "--- 쿠팡 다운로드 ---" >> "$RESULT"
GODIV_TEST_MODE=download GODIV_TEST_PLATFORM=coupang GODIV_TEST_URL="https://www.coupang.com/vp/products/8647955781" run_electron /tmp/godiv_r_cd.log
grep "RESULT_JSON:" /tmp/godiv_r_cd.log | sed 's/.*RESULT_JSON://' >> "$RESULT"

echo "=== cooldown-retry 종료 $(date) ===" >> "$RESULT"
echo "DONE"
