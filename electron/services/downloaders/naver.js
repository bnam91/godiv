// naver.js — 네이버 스마트스토어 상세페이지 이미지 추출.
// 참고 스킬: /Users/a1/.claude/skills/div_download_naver/SKILL.md
// 주 셀렉터: img.se-image-resource (SE에디터 본문 = 리뷰/추천 자동 제외)
// 폴백: #INTRODUCE, .se-viewer, [class*="detail"], [class*="Detail"]
// 주의: lazy load → 추출 전 1000px씩 스크롤 트리거 필수, data-src 우선

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// lazy load 이미지를 로드시키기 위해 문서 끝까지 1000px씩 스크롤한다.
// (puppeteer 최신은 page.waitForTimeout이 없을 수 있어 node 쪽 setTimeout으로 대기)
async function triggerLazyLoad(page) {
  let lastHeight = 0;
  for (let step = 0; step < 200; step++) {
    const height = await page.evaluate((y) => {
      window.scrollTo(0, y);
      return document.body.scrollHeight;
    }, step * 1000);
    await sleep(200);
    // 문서 끝을 지나면 종료 (높이가 더 안 늘어나고 스크롤도 끝까지 감)
    if (step * 1000 > height && height === lastHeight) break;
    lastHeight = height;
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1500);
  // 맨 위로 복귀 (getBoundingClientRect 기준 Y좌표 정합)
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
}

export async function extractNaver(page) {
  await triggerLazyLoad(page);

  const result = await page.evaluate(() => {
    // --- title ---
    const titleSelectors = [
      'h3._22kNQuEXmb',
      'h3',
      '[class*="product"] [class*="title"]',
      '[class*="Product"] [class*="title"]',
      '._3oDjSvLwq9',
    ];
    let title = '';
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const t = el && el.textContent ? el.textContent.trim() : '';
      if (t) {
        title = t;
        break;
      }
    }
    if (!title) title = (document.title || '').trim();

    // --- images ---
    let nodes = document.querySelectorAll('img.se-image-resource');
    if (nodes.length === 0) {
      const detail = document.querySelector(
        '#INTRODUCE, .se-viewer, [class*="detail"], [class*="Detail"]'
      );
      if (detail) nodes = detail.querySelectorAll('img');
    }

    const toAbs = (u) => {
      try {
        return new URL(u, document.baseURI).href;
      } catch {
        return '';
      }
    };

    const seen = new Set();
    const images = [];
    for (const img of nodes) {
      const raw = img.getAttribute('data-src') || img.getAttribute('src') || '';
      if (!raw) continue;
      // 트래킹픽셀/아이콘/base64 필터
      if (raw.startsWith('data:')) continue;
      const url = toAbs(raw);
      if (!url || !/^https?:/i.test(url)) continue;

      // 1x1 트래킹픽셀/아이콘 크기 필터
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && h > 0 && (w <= 2 || h <= 2)) continue;

      if (seen.has(url)) continue;
      seen.add(url);

      const y = img.getBoundingClientRect().top + window.scrollY;
      images.push({ url, y });
    }

    images.sort((a, b) => a.y - b.y);
    return { title, images };
  });

  return result;
}
