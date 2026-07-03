// 통합 테스트 하네스 — electron 컨텍스트에서 실제 다운로드 파이프라인을 돌린다.
// 사용: GODIV_TEST_MODE=<mode> arch -arm64 npx electron test/run-download.mjs
//   mode=coupang-search  : 쿠팡에서 GODIV_TEST_KEYWORD 검색 → 리뷰 많은 상품 목록 JSON
//   mode=download        : GODIV_TEST_URL / GODIV_TEST_PLATFORM 상세 다운로드
//   mode=naver-search    : naverKeywordSearch(GODIV_TEST_KEYWORD)
import { app } from 'electron';
import puppeteer from 'puppeteer-core';
import { access } from 'fs/promises';
import { join } from 'path';
import { downloadDetail, naverKeywordSearch, closeBrowser } from '../electron/services/browserService.js';

const MODE = process.env.GODIV_TEST_MODE || 'download';
const KEYWORD = process.env.GODIV_TEST_KEYWORD || '햇빛가리개';
const URL = process.env.GODIV_TEST_URL || '';
const PLATFORM = process.env.GODIV_TEST_PLATFORM || 'coupang';
const SAVE_ROOT = process.env.GODIV_TEST_SAVEROOT || '';

async function findChromePath() {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const p of paths) { try { await access(p); return p; } catch {} }
  return null;
}

// 쿠팡 검색 — 실제 크롬 headful 로 상품 카드(리뷰수 포함) 추출
async function coupangSearch(keyword) {
  const chromePath = await findChromePath();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: null,
    userDataDir: join(app.getPath('userData'), 'godiv-chrome-profile'),
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  const searchUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&sorter=saleCountDesc`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));
  const items = await page.evaluate(() => {
    const out = [];
    const cards = document.querySelectorAll('li.search-product, ul#productList > li, [class*="ProductUnit"]');
    cards.forEach((li) => {
      const a = li.querySelector('a');
      const name = li.querySelector('[class*="name"], .name')?.textContent?.trim() || '';
      const reviewTxt = li.querySelector('[class*="rating-total-count"], .rating-total-count')?.textContent || '';
      const review = parseInt(reviewTxt.replace(/[^0-9]/g, '') || '0', 10);
      let href = a?.getAttribute('href') || '';
      if (href && href.startsWith('/')) href = 'https://www.coupang.com' + href;
      if (href && name) out.push({ name, review, url: href });
    });
    return out;
  }).catch(() => []);
  await browser.close().catch(() => {});
  items.sort((a, b) => b.review - a.review);
  return items.slice(0, 8);
}

app.whenReady().then(async () => {
  try {
    if (MODE === 'coupang-search') {
      const items = await coupangSearch(KEYWORD);
      console.log('RESULT_JSON:' + JSON.stringify(items));
    } else if (MODE === 'naver-search') {
      const res = await naverKeywordSearch(KEYWORD, null);
      console.log('RESULT_JSON:' + JSON.stringify(res));
    } else {
      const res = await downloadDetail(
        { url: URL, platform: PLATFORM, saveRoot: SAVE_ROOT || undefined },
        null
      );
      console.log('RESULT_JSON:' + JSON.stringify(res));
    }
  } catch (e) {
    console.log('RESULT_JSON:' + JSON.stringify({ success: false, error: e.message, stack: e.stack }));
  } finally {
    await closeBrowser().catch(() => {});
    app.quit();
  }
});
