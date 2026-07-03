// wadiz.js — 와디즈 펀딩/스토어 상세페이지 이미지 추출. (신규 작성, 베스트에포트)
// 기존 와디즈 전용 스킬 없음 → coupang.js/naver.js 패턴에 맞춰 상세영역 img 추출.
// 상세(스토리) 컨테이너 후보를 여러 개 관대하게 시도한다.
// 셀렉터: [class*="ProjectDetail"], [class*="Detail"]/[class*="detail"], [class*="Story"]/[class*="story"],
//         .campaign-detail, .se-viewer, [class*="content"] img
// 타이틀: h1, [class*="Title"], [class*="title"] → 폴백 document.title

const DETAIL_IMG_SELECTOR = [
  '[class*="ProjectDetail"] img',
  '[class*="detail"] img',
  '[class*="Detail"] img',
  '.campaign-detail img',
  '[class*="story"] img',
  '[class*="Story"] img',
  '.se-viewer img',
  '[class*="content"] img',
].join(', ');

const TITLE_SELECTOR = 'h1, [class*="title"], [class*="Title"]';

// lazy-load 상세 이미지를 끌어올리기 위해 대상 컨텍스트(page 또는 frame)를 1000px씩 문서 끝까지 스크롤한다.
async function autoScroll(ctx) {
  await ctx.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let last = 0;
    // 문서 높이가 lazy-load로 계속 늘어날 수 있으므로 안정될 때까지(최대 60스텝) 내려간다.
    for (let i = 0; i < 60; i++) {
      window.scrollBy(0, 1000);
      await sleep(200);
      const h = document.body ? document.body.scrollHeight : 0;
      if (h === last && i > 3) break;
      last = h;
    }
    window.scrollTo(0, 0);
    await sleep(300);
  });
}

// 주어진 컨텍스트(page/frame)에서 상세 이미지 {url, y} 목록을 수집한다.
async function collectFrom(ctx, sel) {
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
        // lazy 로딩 대비: data-src 우선, 이후 src/currentSrc 등 후보.
        const cands = [
          img.getAttribute('data-src'),
          img.getAttribute('data-original'),
          img.getAttribute('data-lazy'),
          img.getAttribute('data-img-src'),
          img.currentSrc,
          img.getAttribute('src'),
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
        // base64/data URI, 1x1 트래킹 픽셀, sprite/icon/logo류 제외.
        if (/^data:/i.test(url)) return;
        if (/1x1|pixel|spacer|blank\.gif|tracking|beacon/i.test(url)) return;
        if (/sprite|icon|logo|favicon|badge|emoji/i.test(url)) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w && h && w <= 2 && h <= 2) return;
        // 아이콘 크기(가로/세로 50px 이하)는 상세 이미지가 아닐 가능성이 커 제외.
        if (w && h && w <= 50 && h <= 50) return;
        if (seen.has(url)) return;
        seen.add(url);
        const rect = img.getBoundingClientRect();
        out.push({ url, y: rect.top + window.scrollY });
      });
      return out;
    },
    sel
  );
}

async function readTitle(ctx) {
  return ctx.evaluate((sel) => {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const t = (el.textContent || '').trim();
      if (t) return t;
    }
    return (document.title || '').trim();
  }, TITLE_SELECTOR);
}

export async function extractWadiz(page) {
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
    images = await collectFrom(page, DETAIL_IMG_SELECTOR);
  } catch {
    images = [];
  }

  // 상세가 iframe 안에 있는 경우, 프레임에서도 추출을 시도한다.
  for (const frame of page.frames()) {
    try {
      if (frame === page.mainFrame()) continue;
    } catch {
      // mainFrame 접근 불가 시 그냥 진행.
    }
    try {
      await autoScroll(frame).catch(() => {});
      const framed = await collectFrom(frame, DETAIL_IMG_SELECTOR);
      if (framed && framed.length) {
        // 프레임 로컬 y → 메인 페이지 전역 y로 보정(iframe 위치 오프셋 추가)
        let offsetY = 0;
        try {
          const handle = await frame.frameElement();
          if (handle) {
            const box = await handle.boundingBox();
            if (box) offsetY = box.y + (await page.evaluate(() => window.scrollY));
            await handle.dispose?.();
          }
        } catch { /* 미지원/접근불가 → 오프셋 0 */ }
        images = images.concat(framed.map((it) => ({ ...it, y: (it.y || 0) + offsetY })));
      }
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
