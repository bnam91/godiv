// coupang.js — 쿠팡 상세페이지 이미지 추출.
// 참고 스킬: /Users/a1/.claude/skills/div_download_coupang/skill.md
// 셀렉터: [class*="detail"] img, #pdp-detail-contents img, .prod-description-content img
// 타이틀: h1.prod-buy-header__title, .prod-title, h2

const DETAIL_IMG_SELECTOR =
  '[class*="detail"] img, #pdp-detail-contents img, .prod-description-content img';
const TITLE_SELECTOR = 'h1.prod-buy-header__title, .prod-title, h2';

// lazy-load 상세 이미지를 끌어올리기 위해 대상 컨텍스트(page 또는 frame)를 여러 번 스크롤한다.
async function autoScroll(ctx) {
  await ctx.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let last = 0;
    // 문서 높이가 lazy-load로 계속 늘어날 수 있으므로 안정될 때까지(최대 40스텝) 내려간다.
    for (let i = 0; i < 40; i++) {
      window.scrollBy(0, window.innerHeight);
      await sleep(250);
      const h = document.body ? document.body.scrollHeight : 0;
      if (h === last && i > 3) break;
      last = h;
    }
    window.scrollTo(0, 0);
    await sleep(300);
  });
}

// 주어진 컨텍스트(page/frame)에서 상세 이미지 {url, y} 목록을 수집한다.
async function collectFrom(ctx) {
  return ctx.evaluate(
    (sel) => {
      const abs = (u) => {
        if (!u) return null;
        try {
          return new URL(u, document.baseURI).href;
        } catch {
          return null;
        }
      };
      const pick = (img) => {
        // lazy 로딩 대비: src가 비었거나 placeholder면 data-* 후보로 대체.
        const cands = [
          img.currentSrc,
          img.getAttribute('src'),
          img.getAttribute('data-src'),
          img.getAttribute('data-original'),
          img.getAttribute('data-lazy'),
          img.getAttribute('data-img-src'),
        ];
        for (const c of cands) {
          const u = abs(c);
          if (u && /^https?:/i.test(u)) return u;
        }
        return null;
      };
      const out = [];
      const seen = new Set();
      document.querySelectorAll(sel).forEach((img) => {
        const url = pick(img);
        if (!url) return;
        // base64/data URI, 1x1 트래킹 픽셀, sprite/icon류 제외.
        if (/^data:/i.test(url)) return;
        if (/1x1|pixel|spacer|blank\.gif/i.test(url)) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w && h && w <= 2 && h <= 2) return;
        if (seen.has(url)) return;
        seen.add(url);
        const rect = img.getBoundingClientRect();
        out.push({ url, y: rect.top + window.scrollY });
      });
      return out;
    },
    DETAIL_IMG_SELECTOR
  );
}

async function readTitle(ctx) {
  return ctx.evaluate((sel) => {
    const el = document.querySelector(sel);
    const t = el && (el.textContent || '').trim();
    return t || (document.title || '').trim();
  }, TITLE_SELECTOR);
}

export async function extractCoupang(page) {
  // 메인 문서 스크롤로 lazy 이미지 강제 로드.
  await autoScroll(page).catch(() => {});

  let title = '';
  try {
    title = await readTitle(page);
  } catch {
    title = '';
  }

  let images = [];
  try {
    images = await collectFrom(page);
  } catch {
    images = [];
  }

  // 쿠팡 상세가 iframe 안에 있는 경우, 프레임에서도 추출을 시도한다.
  for (const frame of page.frames()) {
    try {
      if (frame === page.mainFrame()) continue;
    } catch {
      // mainFrame 접근 불가 시 그냥 진행.
    }
    try {
      await autoScroll(frame).catch(() => {});
      const framed = await collectFrom(frame);
      if (framed && framed.length) images = images.concat(framed);
      if (!title) title = await readTitle(frame).catch(() => '');
    } catch {
      // cross-origin 등으로 접근 불가한 프레임은 건너뛴다.
    }
  }

  // URL 기준 중복 제거 후 y좌표 정렬.
  const seen = new Set();
  images = images.filter((it) => {
    if (!it || !it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
  images.sort((a, b) => a.y - b.y);

  return { title: title || '', images };
}
