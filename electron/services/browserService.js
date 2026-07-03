// browserService.js — puppeteer-core로 시스템 크롬을 띄워 상세페이지 이미지를 긁어 저장하는 서비스.
// 계약(변경 금지 인터페이스):
//   downloadDetail({ url, platform, folderName?, saveRoot? }, sender)
//     → { success, folderPath, files:[names], title, folderName, count }
//   naverKeywordSearch(keyword, sender)
//     → { success, items:[{ title, reviewCount, thumbnail, url }] }
//   closeBrowser() → 크롬/puppeteer 정리
// 진행상황: sender.send('download-progress', { message, current?, total? })

import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
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

// puppeteer-core를 puppeteer-extra로 감싸 stealth(webdriver/plugins/webgl/chrome 등 탐지 회피) 적용.
// 시스템 크롬 headful에도 동작하며, 봇차단(Akamai/네이버) 통과율을 높인다.
const puppeteer = addExtra(puppeteerCore);
try {
  puppeteer.use(StealthPlugin());
} catch (e) {
  console.log('[browserService] stealth 플러그인 로드 경고:', e.message);
}

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

// ── 봇차단 회피 유틸 ─────────────────────────────────────────────

// 자동화 탐지 신호를 줄이는 스텔스 스크립트(navigator.webdriver 등).
async function applyStealth(page) {
  try {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      // chrome 런타임 객체 흉내
      window.chrome = window.chrome || { runtime: {} };
      const orig = navigator.permissions && navigator.permissions.query;
      if (orig) {
        navigator.permissions.query = (p) =>
          p && p.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : orig(p);
      }
    });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });
  } catch (e) {
    log('스텔스 적용 경고:', e.message);
  }
}

// 플랫폼 홈을 먼저 방문해 세션/쿠키를 데운다.
async function warmup(page, platform, force = false) {
  const homes = {
    coupang: 'https://www.coupang.com/',
    naver: 'https://smartstore.naver.com/',
    wadiz: 'https://www.wadiz.kr/',
  };
  const home = homes[platform];
  if (!home) return;
  await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  // 사람스러운 짧은 체류 + 스크롤
  await new Promise((r) => setTimeout(r, force ? 3500 : 2000));
  await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
}

// 네이버 상품 상세 진입 (★검색→클릭 방식).
// 네이버 스마트스토어는 상세 딥링크 '직접 goto'를 소프트 차단("시스템오류/접속 불가")한다.
// 반면 통합검색(nexearch) 결과의 NaPm 트래킹 앵커를 '실제 클릭'하면 정상 로드된다.
// → keyword 힌트가 있으면 검색결과에서 해당 productId 앵커를 찾아 클릭한다.
// 반환: 성공 시 true(page가 상품 상세로 전환됨), 진입 불가 시 false.
async function navigateNaverViaSearch(page, keyword, productId) {
  if (!keyword || !productId) return false;
  try {
    await page.goto('https://www.naver.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const searchUrl = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => log('naver 검색 goto 경고:', e.message));
    await new Promise((r) => setTimeout(r, 2000));
    // lazy 렌더 유도(쇼핑섹션 상품 앵커 노출)
    await page.evaluate(async () => {
      for (let y = 0; y < 6000; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));

    // 대상 productId 앵커를 찾아 같은 탭에서 클릭(NaPm 트래킹 체인으로 정상 진입).
    const clicked = await page.evaluate((pid) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'))
        .filter((a) => new RegExp('/products/' + pid + '(?:[/?#]|$)').test(a.href));
      // 네이버 자체 스토어 우선(스마트스토어/브랜드/main 트래킹)
      const target = anchors.find((a) => /naver\.com\/(main|[^/]+)\/products\//.test(a.href)) || anchors[0];
      if (!target) return false;
      target.setAttribute('target', '_self');
      target.scrollIntoView();
      target.click();
      return true;
    }, String(productId));
    if (!clicked) { log('검색결과에서 productId 앵커 없음:', productId); return false; }

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 50000 }).catch((e) => log('naver 클릭 네비 경고:', e.message));
    await new Promise((r) => setTimeout(r, 2500));
    return true;
  } catch (e) {
    log('navigateNaverViaSearch 오류:', e.message);
    return false;
  }
}

// Access Denied / 봇차단 페이지 여부 감지.
async function isBlockedPage(page) {
  try {
    const info = await page.evaluate(() => ({
      title: document.title || '',
      bodyLen: (document.body && document.body.innerText || '').length,
      text: (document.body && document.body.innerText || '').slice(0, 400),
    }));
    const hay = (info.title + ' ' + info.text).toLowerCase();
    const blockedSignals = [
      'access denied', 'reference #', 'akamai', 'forbidden',
      '접근이 거부', '비정상적인 접근', 'unusual traffic', 'are you a human',
      'captcha', 'blocked', 'error 403',
      // 네이버 스마트스토어 소프트 봇차단/레이트리밋 페이지
      '접속이 불가', '시스템오류', '시스템 오류', '에러페이지',
      '동시에 접속하는 이용자', '일시적으로 제한', '서비스 접속이 일시적',
    ];
    if (blockedSignals.some((s) => hay.includes(s))) return true;
    // 본문이 사실상 비어있고 타이틀도 의심스러우면 차단으로 간주
    if (info.bodyLen < 30 && /denied|error|block/.test(hay)) return true;
    return false;
  } catch {
    return false;
  }
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
    await applyStealth(page);

    // 네이버는 상세 딥링크 직접 goto를 소프트 차단하므로, 검색→클릭 진입을 우선 시도한다.
    // keyword 힌트는 URL 프래그먼트(#godiv-kw=)로 전달됨(naverKeywordSearch가 부착).
    let navUrl = url;
    let usedNaverSearch = false;
    if (platform === 'naver') {
      let keywordHint = '';
      try {
        const u = new URL(url);
        if (u.hash) {
          const m = u.hash.match(/godiv-kw=([^&]+)/);
          if (m) keywordHint = decodeURIComponent(m[1]);
        }
        navUrl = u.origin + u.pathname + u.search; // 다운로드/폴더명 판단용 정규 URL
      } catch {}
      const productId = extractProductId(navUrl);
      if (keywordHint && productId) {
        sendProgress(sender, { message: '네이버 검색으로 진입 중…' });
        log('naver 검색→클릭 진입:', keywordHint, productId);
        usedNaverSearch = await navigateNaverViaSearch(page, keywordHint, productId);
      }
    }

    if (!usedNaverSearch) {
      // 웜업: 상세 딥링크 직접 접근은 Akamai/봇차단에 걸리기 쉬움 → 홈을 먼저 방문해
      // 세션/쿠키를 데운 뒤 상세로 이동(영구 프로필이라 다음부터는 더 잘 통과).
      sendProgress(sender, { message: '세션 준비 중…' });
      await warmup(page, platform).catch((e) => log('웜업 경고(계속):', e.message));

      sendProgress(sender, { message: '페이지 여는 중…' });
      log('goto:', navUrl);
      // 네이버 등은 무거운 SPA — 타임아웃 나도 페이지가 열려 있으면 계속 진행.
      try {
        await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (navErr) {
        log('goto 타임아웃/경고(계속 진행):', navErr.message);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 봇차단(Access Denied/네이버 시스템오류 등) 감지 → 재시도.
    if (await isBlockedPage(page)) {
      const blockText = await page.evaluate(() => ({
        title: document.title || '',
        text: (document.body && document.body.innerText || '').slice(0, 200),
      })).catch(() => ({ title: '', text: '' }));
      log('봇차단 감지 — 재시도:', blockText.title);
      sendProgress(sender, { message: '차단 감지 — 재시도 중…' });
      await new Promise((r) => setTimeout(r, 3000));
      // 네이버는 재웜업 goto가 아니라 검색→클릭을 다시 시도(직접 goto는 계속 차단됨).
      let recovered = false;
      if (usedNaverSearch) {
        const productId = extractProductId(navUrl);
        const kwRetry = (() => { try { const m = new URL(url).hash.match(/godiv-kw=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; } })();
        if (kwRetry && productId) recovered = await navigateNaverViaSearch(page, kwRetry, productId);
      } else {
        await warmup(page, platform, true).catch(() => {});
        await new Promise((r) => setTimeout(r, 2000));
        try { await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }); recovered = true; } catch {}
      }
      await new Promise((r) => setTimeout(r, 1500));
      if (!recovered || await isBlockedPage(page)) {
        return {
          success: false,
          blocked: true,
          blockTitle: blockText.title,
          blockText: blockText.text,
          error: `사이트가 자동 접근을 차단했습니다(${blockText.title || 'Access Denied'}). 열린 크롬 창에서 직접 로그인/캡차를 통과한 뒤 다시 시도하거나, 잠시 후(IP 쿨다운) 재시도해주세요.`,
        };
      }
    }

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

    const resolvedFolder = resolveFolderName(folderName, title, navUrl);
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
        const { buf, ext: ctExt } = await fetchImage(imgUrl, navUrl);
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
    await applyStealth(page);

    // 네이버 홈을 먼저 방문해 세션/쿠키를 데운다(딥링크 직접 접근 시 봇차단 완화).
    await page.goto('https://www.naver.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    // ★ search.shopping.naver.com / msearch 는 IP 기반 봇차단("쇼핑 서비스 접속이
    //   일시적으로 제한되었습니다")에 매우 취약 → 통합검색(nexearch) 쇼핑섹션을 사용한다.
    //   통합검색 결과에는 네이버 자체 스토어(smartstore/brand) 상품 딥링크가 노출됨.
    const searchUrl = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`;
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (navErr) {
      log('naver 검색 goto 경고(계속):', navErr.message);
    }
    // lazy 렌더 유도
    await new Promise((r) => setTimeout(r, 2000));
    try {
      await page.evaluate(async () => {
        for (let y = 0; y < 6000; y += 700) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 250));
        }
        window.scrollTo(0, 0);
      });
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));

    // 통합검색 쇼핑섹션에서 '네이버 자체 스토어' 상품 카드만 채집.
    const items = await page.evaluate(() => {
      const out = [];
      const seen = new Set();

      const toNum = (s) => {
        if (!s) return 0;
        const m = String(s).replace(/[,\s]/g, '').match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      };

      // 네이버 자체 스토어 상품 딥링크만(외부몰 11번가/G마켓 등 제외). platform=naver 다운로드 대상.
      const isNaverProduct = (href) =>
        /(smartstore|brand)\.naver\.com\/[^?#]*\/products\/\d+/.test(href) ||
        /shopping\.naver\.com\/[^?#]*\/products\/\d+/.test(href);

      const anchors = Array.from(document.querySelectorAll('a[href]'))
        .filter((a) => isNaverProduct(a.href));

      for (const a of anchors) {
        if (out.length >= 10) break;

        // 쿼리스트링(nl-query 등) 제거한 정규 상품 URL
        let url = a.href;
        try { const u = new URL(a.href); url = u.origin + u.pathname; } catch {}
        if (!url || seen.has(url)) continue;

        // 카드 조상: img + 충분한 텍스트가 있는 가장 가까운 컨테이너
        let card = null, el = a;
        for (let i = 0; i < 6 && el; i++) {
          el = el.parentElement;
          if (el && el.querySelector('img') && (el.innerText || '').length > 10) { card = el; break; }
        }
        if (!card) card = a.closest('li, div') || a.parentElement;
        if (!card) continue;

        const imgEl = card.querySelector('img');

        // 제목: img[alt] → a[title]/텍스트 → 카드 첫 줄(가격/평점 라인 제외)
        let title = '';
        if (imgEl) title = (imgEl.getAttribute('alt') || '').trim();
        if (!title) title = (a.getAttribute('title') || a.textContent || '').trim();
        if (!title) {
          const lines = (card.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
          title = lines.find((l) => l.length > 6 && !/^[\d,.\s%원]+$/.test(l) && !/^\(\d/.test(l)) || '';
        }
        if (!title) continue;

        // 썸네일
        const thumbnail = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';

        // 리뷰 수: "리뷰 1,234" / "리뷰수: 363" / "(456)" 형태
        let reviewCount = 0;
        const txt = card.innerText || '';
        let m = txt.match(/리뷰\s*수?\s*:?\s*([\d,]+)/);
        if (!m) m = txt.match(/\(([\d,]{1,9})\)/);
        if (m) reviewCount = toNum(m[1]);

        seen.add(url);
        out.push({ title: title.slice(0, 120), reviewCount, thumbnail, url });
      }
      return out;
    });

    // 다운로드 시 '검색→클릭' 진입에 쓸 키워드를 URL 프래그먼트로 부착(#godiv-kw=).
    // 프래그먼트는 서버로 전송되지 않아 무해하며, 플랫폼 판별(호스트명)에도 영향 없음.
    const kwFrag = `#godiv-kw=${encodeURIComponent(keyword)}`;
    const itemsWithKw = items.map((it) => ({ ...it, url: it.url + kwFrag }));

    sendProgress(sender, { message: `검색 완료: ${items.length}건` });
    return { success: true, items: itemsWithKw };
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
