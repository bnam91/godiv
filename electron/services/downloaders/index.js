// downloaders/index.js — 플랫폼별 추출기 디스패치.
// 각 추출기 계약: async extract(page) → { title, images: [{ url, y }] }
//   - page: puppeteer Page
//   - title: 폴더명 자동결정용 상품 타이틀
//   - images: 상세페이지 이미지 URL + Y좌표(정렬용)
import { extractCoupang } from './coupang.js';
import { extractNaver } from './naver.js';
import { extractWadiz } from './wadiz.js';

const EXTRACTORS = {
  coupang: extractCoupang,
  naver: extractNaver,
  wadiz: extractWadiz,
};

export function getExtractor(platform) {
  return EXTRACTORS[platform] || null;
}
