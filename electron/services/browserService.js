// browserService.js — puppeteer-core로 시스템 크롬을 CDP로 몰고 다니는 서비스.
// [SCAFFOLD STUB] 항목 3(브라우저 서비스) 에이전트가 채운다.
// 계약(변경 금지 인터페이스):
//   downloadDetail({ url, platform, folderName?, saveRoot? }, sender)
//     → { success, folderPath, files:[names], title, count }
//     진행상황은 sender.send('download-progress', { phase, message, current?, total? })
//   naverKeywordSearch(keyword, sender)
//     → { success, items:[{ title, reviewCount, thumbnail, url }] }
//   closeBrowser() → 크롬/puppeteer 정리
//
// 구현 참고:
//   - findChromePath(): 리뷰크롤러 electron/services/browserService.js 이식(맥/윈/리눅스 + which)
//   - 전용 userDataDir: userData/godiv-chrome-profile (네이버 세션 유지)
//   - 추출 로직: ./downloaders/index.js 의 getExtractor(platform)
//   - 이미지 저장: axios로 URL→ saveRoot/folderName/NN.ext (Y좌표 정렬 순번, GIF 원본)

import { getExtractor } from './downloaders/index.js';

export async function downloadDetail(opts, sender) {
  return { success: false, error: '[STUB] browserService.downloadDetail 미구현 — 항목3 에이전트 대기', _opts: opts, _hasExtractor: !!getExtractor };
}

export async function naverKeywordSearch(keyword, sender) {
  return { success: false, error: '[STUB] naverKeywordSearch 미구현 — 항목6 에이전트 대기', _keyword: keyword };
}

export async function closeBrowser() {
  return true;
}
