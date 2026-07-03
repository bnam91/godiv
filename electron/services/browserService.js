// browserService.js — puppeteer-core로 시스템 크롬을 띄워 상세페이지 이미지를 긁어 저장하는 서비스.
// 계약(변경 금지 인터페이스):
//   downloadDetail({ url, platform, folderName?, saveRoot? }, sender)
//     → { success, folderPath, files:[names], title, folderName, count }
//   naverKeywordSearch(keyword, sender)
//     → { success, items:[{ title, reviewCount, thumbnail, url }] }
//   closeBrowser() → 크롬/puppeteer 정리
// 진행상황: sender.send('download-progress', { message, current?, total? })

import puppeteer from 'puppeteer-core';
import axios from 'axios';
import https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { access, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { app } from 'electron';
import { getExtractor } from './downloaders/index.js';
import { allowRoot } from './imageStore.js';

const execAsync = promisify(exec);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 자체 서명/느슨한 SSL(coupangcdn, pstatic) 대응 — 이미지 다운로드 전용
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// ── 모듈 레벨 브라우저 캐시 (재사용) ──────────────────────────────
let browserInstance = null;

function log(...args) {
  console.log('[browserService]', ...args);
}

function sendProgress(sender, payload) {
  try {
    if (sender && typeof sender.send === 'function' && !sender.isDestroyed?.()) {
      sender.send('download-progress', payload);
    }
  } catch {
    /* sender 소멸 등은 무시 */
  }
}

/**
 * 시스템 크롬/크로미움 실행 경로 탐지 (맥/윈/리눅스 + which 폴백).
 * 리뷰크롤러 client-review-crawler/electron/services/browserService.js 이식.
 */
async function findChromePath() {
  const platform = process.platform;

  if (platform === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const p of paths) {
      try { await access(p); return p; } catch { continue; }
    }
    try {
      const { stdout } = await execAsync('which google-chrome || which chromium || which chromium-browser');
      return stdout.trim() || null;
    } catch {
      return null;
    }
  } else if (platform === 'win32') {
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of paths) {
      try { await access(p); return p; } catch { continue; }
    }
    return null;
  } else {
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
    for (const p of paths) {
      try { await access(p); return p; } catch { continue; }
    }
    try {
      const { stdout } = await execAsync('which google-chrome-stable || which google-chrome || which chromium || which chromium-browser');
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

/**
 * 캐시된 브라우저를 반환하거나 새로 띄운다.
 * 전용 userDataDir(godiv-chrome-profile)로 네이버 세션 유지.
 * SingletonLock 충돌 시 stale lock 정리 후 1회 재시도.
 */
let browserLaunchPromise = null; // 동시 IPC로 프로필이 이중 기동되지 않도록 하는 뮤텍스

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  // 이미 다른 호출이 기동 중이면 그 결과를 공유
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = (async () => {
    try {
      return await launchBrowser();
    } finally {
      browserLaunchPromise = null;
    }
  })();
  return browserLaunchPromise;
}

async function launchBrowser() {
  browserInstance = null;

  const chromePath = await findChromePath();
  if (!chromePath) {
    throw new Error('크롬 브라우저를 찾을 수 없습니다. Chrome 또는 Chromium 설치를 확인해주세요.');
  }
  log('Chrome path:', chromePath);

  const userDataDir = join(app.getPath('userData'), 'godiv-chrome-profile');
  try { await mkdir(userDataDir, { recursive: true }); } catch {}
  log('userDataDir:', userDataDir);

  const launchOptions = {
    executablePath: chromePath,
    headless: false, // 사용자가 로그인/캡차 대응할 수 있게
    defaultViewport: null,
    userDataDir,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
  };

  try {
    browserInstance = await puppeteer.launch(launchOptions);
  } catch (e) {
    const msg = (e && e.message) || '';
    const isLockConflict =
      msg.includes('already running') ||
      msg.includes('SingletonLock') ||
      msg.includes('ProcessSingleton');
    if (!isLockConflict) throw e;

    log('⚠️ SingletonLock 충돌 감지 — 이전 인스턴스 정리 후 재시도');
    // 기존 프로필 프로세스 kill
    try {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        await execAsync(`pkill -9 -f "user-data-dir=${userDataDir}" || true`);
      }
    } catch {}
    // stale lock 파일 정리
    for (const lf of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { await unlink(join(userDataDir, lf)); } catch {}
    }
    await new Promise((r) => setTimeout(r, 1500));
    log('🔄 puppeteer.launch 재시도');
    browserInstance = await puppeteer.launch(launchOptions);
  }

  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });

  return browserInstance;
}

// ── 폴더명 / 파일명 유틸 ─────────────────────────────────────────

/** URL에서 상품 ID 추출 (플랫폼별 경로 → 폴백: 가장 긴 숫자열). */
function extractProductId(url) {
  const u = String(url || '');
  const patterns = [
    /\/vp\/products\/(\d+)/,        // 쿠팡
    /\/products\/(\d+)/,            // 네이버 스마트스토어
    /\/campaign\/detail\/(\d+)/,    // 와디즈
    /[?&](?:productId|itemId|vendorItemId)=(\d+)/,
  ];
  for (const re of patterns) {
    const m = u.match(re);
    if (m) return m[1];
  }
  // 폴백: URL 안의 가장 긴 숫자열
  const nums = u.match(/\d{4,}/g);
  if (nums && nums.length) {
    return nums.sort((a, b) => b.length - a.length)[0];
  }
  return '';
}

/**
 * 타이틀 → 파일시스템 안전 폴더명.
 * 규칙(div_download_coupang 스킬 참고): 브랜드_핵심키워드, 최대 20자,
 * 공백→_, 특수문자/괄호/모델번호/수식어 제거. 판단 불가 시 URL 상품ID.
 */
function sanitizeFolderName(title, url) {
  let s = String(title || '').trim();

  // 대괄호/괄호 안의 광고/수식 문구 제거: [무료배송], (특가) 등
  s = s.replace(/[\[\(【（][^\]\)】）]*[\]\)】）]/g, ' ');

  // 한글/영문/숫자/공백/하이픈만 남기고 나머지(특수문자·기호·이모지) 제거
  s = s.replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ\s_-]/g, ' ');

  // 모델번호처럼 보이는 영문+숫자 혼합 토큰(A1234, GX9 등) 제거
  s = s
    .split(/\s+/)
    .filter((tok) => tok && !(/[A-Za-z]/.test(tok) && /\d/.test(tok)))
    .join(' ');

  // 공백 정리 → 언더스코어
  s = s.replace(/\s+/g, ' ').trim().replace(/\s/g, '_');

  // 최대 20자
  if (s.length > 20) s = s.slice(0, 20);
  s = s.replace(/^_+|_+$/g, '');

  if (!s) {
    const pid = extractProductId(url);
    return pid || 'download';
  }
  return s;
}

/** 사용자가 넘긴 폴더명을 파일시스템 안전 단일 세그먼트로 정리(경로구분자/../ 제거). */
function sanitizeUserFolderName(name) {
  let s = String(name || '').trim();
  // 경로구분자·상위이동·널·제어문자 제거
  s = s.replace(/[\\/\0]/g, '_').replace(/\.\.+/g, '_').replace(/[\x00-\x1f]/g, '');
  s = s.replace(/^\.+/, '').trim(); // 선행 점(숨김/현재/상위) 제거
  if (s.length > 40) s = s.slice(0, 40);
  return s;
}

/** 폴더명 충돌 방지: 사용자 지정이면 sanitize 후 사용, 비면 상품ID/타이틀 휴리스틱. */
function resolveFolderName(folderName, title, url) {
  if (folderName && String(folderName).trim()) {
    const safe = sanitizeUserFolderName(folderName);
    if (safe) return safe;
  }
  return sanitizeFolderName(title, url);
}

const EXT_BY_CONTENT_TYPE = {
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** URL pathname 기준 확장자(쿼리스트링 오염 방지). content-type이 우선. */
function extFromUrl(url) {
  let pathname = String(url || '').toLowerCase();
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { /* 상대/불량 URL은 원문 사용 */ }
  if (pathname.endsWith('.gif')) return 'gif';
  if (pathname.endsWith('.png')) return 'png';
  if (pathname.endsWith('.webp')) return 'webp';
  if (pathname.endsWith('.avif')) return 'avif';
  if (pathname.endsWith('.bmp')) return 'bmp';
  if (pathname.endsWith('.jpeg') || pathname.endsWith('.jpg')) return 'jpg';
  return null; // 판단 불가 → content-type에 위임
}

/** 단일 이미지 다운로드 → { buf, ext }. content-type 검증(HTML 등 비이미지 거부). 실패 시 throw. */
async function fetchImage(url, referer) {
  // 기본 에이전트로 먼저 시도, TLS 오류 시에만 느슨한 에이전트로 재시도(전역 비활성화 지양).
  const doGet = (agent) => axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    maxRedirects: 5,
    ...(agent ? { httpsAgent: agent } : {}),
    headers: {
      'User-Agent': USER_AGENT,
      Referer: referer || '',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  let res;
  try {
    res = await doGet(null);
  } catch (e) {
    const code = e && e.code;
    const tlsIssue = /CERT|SSL|TLS|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(String(code) + ' ' + (e?.message || ''));
    if (!tlsIssue) throw e;
    res = await doGet(insecureAgent); // 자체서명 CDN(coupangcdn/pstatic 등) 폴백
  }

  const ct = String(res.headers?.['content-type'] || '').toLowerCase().split(';')[0].trim();
  if (ct && !ct.startsWith('image/')) {
    // Access Denied HTML 페이지 등 비이미지 응답을 이미지로 저장하지 않도록 거부
    throw new Error(`비이미지 응답(content-type=${ct})`);
  }
  const ctExt = EXT_BY_CONTENT_TYPE[ct] || null;
  return { buf: Buffer.from(res.data), ext: ctExt };
}

// ── 메인: 상세페이지 다운로드 ─────────────────────────────────────

export async function downloadDetail(opts, sender) {
  const { url, platform, folderName, saveRoot } = opts || {};

  if (!url) return { success: false, error: 'URL이 없습니다.' };
  const extractor = getExtractor(platform);
  if (!extractor) {
    return { success: false, error: `지원하지 않는 플랫폼입니다: ${platform}` };
  }

  const { writeFile } = await import('fs/promises');
  let page = null;

  try {
    sendProgress(sender, { message: '브라우저 준비 중…' });
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    sendProgress(sender, { message: '페이지 여는 중…' });
    log('goto:', url);
    // 네이버 등은 무거운 SPA — 타임아웃 나도 페이지가 열려 있으면 계속 진행.
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (navErr) {
      log('goto 타임아웃/경고(계속 진행):', navErr.message);
    }
    // 렌더 안정화 짧은 대기
    await new Promise((r) => setTimeout(r, 1500));

    sendProgress(sender, { message: '이미지 추출 중…' });
    const extracted = await extractor(page);
    const title = (extracted && extracted.title) || (await page.title().catch(() => '')) || '';
    let images = (extracted && Array.isArray(extracted.images)) ? extracted.images : [];

    // Y좌표 오름차순 정렬 후 유효 URL만
    images = images
      .filter((it) => it && it.url && /^https?:/i.test(it.url))
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0));

    if (images.length === 0) {
      return { success: false, error: '추출된 이미지가 없습니다.', title };
    }

    const resolvedFolder = resolveFolderName(folderName, title, url);
    const root = saveRoot || join(homedir(), 'Downloads', 'div_download');
    const folderPath = join(root, resolvedFolder);
    await mkdir(folderPath, { recursive: true });
    allowRoot(folderPath); // 이 폴더를 렌더러 읽기/쓰기 허용 루트로 등록(imageStore 보안)
    log(`저장 대상: ${folderPath} (${images.length}장)`);

    const files = [];
    const total = images.length;
    for (let i = 0; i < total; i++) {
      const { url: imgUrl } = images[i];
      const seq = String(i + 1).padStart(2, '0');
      sendProgress(sender, {
        message: `이미지 저장 중 (${i + 1}/${total})`,
        current: i + 1,
        total,
      });
      try {
        const { buf, ext: ctExt } = await fetchImage(imgUrl, url);
        // content-type 우선, 없으면 URL pathname, 그래도 없으면 jpg
        const ext = ctExt || extFromUrl(imgUrl) || 'jpg';
        const fileName = `${seq}.${ext}`;
        await writeFile(join(folderPath, fileName), buf);
        files.push(fileName);
      } catch (imgErr) {
        log(`이미지 실패 스킵 [${seq}] ${imgUrl} — ${imgErr.message}`);
      }
    }

    sendProgress(sender, {
      message: `완료: ${files.length}장 저장`,
      current: total,
      total,
    });

    return {
      success: files.length > 0,
      folderPath,
      files,
      title,
      folderName: resolvedFolder,
      count: files.length,
      error: files.length === 0 ? '모든 이미지 다운로드에 실패했습니다.' : undefined,
    };
  } catch (err) {
    log('downloadDetail 오류:', err);
    return { success: false, error: err.message || String(err) };
  } finally {
    // 페이지만 닫고 브라우저는 재사용을 위해 유지
    if (page) {
      try { await page.close(); } catch {}
    }
  }
}

// ── 네이버 키워드 검색 폴백 ──────────────────────────────────────

export async function naverKeywordSearch(keyword, sender) {
  if (!keyword || !String(keyword).trim()) {
    return { success: false, error: '검색어가 없습니다.', items: [] };
  }
  let page = null;
  try {
    sendProgress(sender, { message: `"${keyword}" 검색 중…` });
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    const searchUrl = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`;
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (navErr) {
      log('naver 검색 goto 경고(계속):', navErr.message);
    }
    // lazy 렌더 유도
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await page.evaluate(async () => {
        for (let y = 0; y < 3000; y += 800) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 200));
        }
        window.scrollTo(0, 0);
      });
    } catch {}
    await new Promise((r) => setTimeout(r, 800));

    // 봇 차단·구조 변경에 대비해 여러 셀렉터 후보를 순차 시도
    const items = await page.evaluate(() => {
      const out = [];
      const seen = new Set();

      const toNum = (s) => {
        if (!s) return 0;
        const m = String(s).replace(/[,\s]/g, '').match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      };

      // 상품 카드 컨테이너 후보들
      const cardSelectors = [
        'div[class*="product_item"]',
        'div[class*="basicList_item"]',
        'li[class*="list_item"]',
        'div[class*="adProduct_item"]',
        'div[data-shp-area-type]',
      ];
      let cards = [];
      for (const sel of cardSelectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length) { cards = found; break; }
      }
      // 폴백: 상품 링크 기준으로 조상 카드 추정
      if (!cards.length) {
        const links = Array.from(
          document.querySelectorAll('a[href*="/catalog/"], a[href*="smartstore.naver.com"], a[href*="/products/"]')
        );
        cards = links.map((a) => a.closest('li, div')).filter(Boolean);
      }

      for (const card of cards) {
        if (out.length >= 10) break;

        const linkEl = card.querySelector(
          'a[href*="/catalog/"], a[href*="smartstore.naver.com"], a[href*="brand.naver.com"], a[href*="/products/"], a[href^="http"]'
        );
        const url = linkEl && linkEl.href;
        if (!url || seen.has(url)) continue;

        // 제목 후보
        let title = '';
        const titleEl = card.querySelector(
          '[class*="title"], [class*="name"], a[title]'
        );
        if (titleEl) {
          title = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
        }
        if (!title && linkEl) title = (linkEl.getAttribute('title') || linkEl.textContent || '').trim();
        if (!title) continue;

        // 썸네일
        const imgEl = card.querySelector('img');
        const thumbnail = imgEl
          ? (imgEl.src || imgEl.getAttribute('data-src') || '')
          : '';

        // 리뷰 수
        let reviewCount = 0;
        const reviewEl = card.querySelector('[class*="review"], [class*="Review"]');
        if (reviewEl) reviewCount = toNum(reviewEl.textContent);
        if (!reviewCount) {
          const m = (card.textContent || '').match(/리뷰\s*([\d,]+)/);
          if (m) reviewCount = toNum(m[1]);
        }

        seen.add(url);
        out.push({ title: title.slice(0, 120), reviewCount, thumbnail, url });
      }
      return out;
    });

    sendProgress(sender, { message: `검색 완료: ${items.length}건` });
    return { success: true, items };
  } catch (err) {
    log('naverKeywordSearch 오류:', err);
    // 부분 실패 허용 — 빈 목록으로 반환
    return { success: false, error: err.message || String(err), items: [] };
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }
}

// ── 정리 ─────────────────────────────────────────────────────────

export async function closeBrowser() {
  try {
    if (browserInstance) {
      await browserInstance.close();
    }
  } catch (e) {
    log('closeBrowser 경고:', e.message);
  } finally {
    browserInstance = null;
  }
  return true;
}
