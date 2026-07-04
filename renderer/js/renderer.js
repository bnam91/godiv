// renderer.js — godiv UI 오케스트레이터
import { detectPlatform } from './platform.js';
import { createCanvasController } from './canvas.js';
import { mergeItems } from './merge.js';

const $ = (id) => document.getElementById(id);

// ── 상태 ──────────────────────────────────────────────────────
let settings = { saveRoot: '', lastFolderName: '' };
let currentPlatform = 'unknown';

// ── 토스트 ────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}
window.__godivToast = toast;

function log(msg) {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
}
function setProgress(pct) { $('progress-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`; }

// ── 캔버스 ────────────────────────────────────────────────────
const canvas = createCanvasController({
  stageEl: $('canvas-stage'),
  scrollEl: $('canvas-scroll'),
  folderLabelEl: $('canvas-folder-label'),
  onSelectionChange: (sel) => { $('merge-btn').disabled = sel.length < 2; },
});

// ── 플랫폼 뱃지 ───────────────────────────────────────────────
function updateBadge(url) {
  const d = detectPlatform(url);
  currentPlatform = d.platform;
  const badge = $('platform-badge');
  badge.textContent = d.label;
  badge.style.color = d.platform === 'unknown' ? 'var(--text-dim)' : '#fff';
  badge.style.background = d.platform === 'unknown' ? 'var(--panel-2)' : d.color;
  badge.style.borderColor = d.platform === 'unknown' ? 'var(--border)' : d.color;
}

// ── 초기화 ────────────────────────────────────────────────────
async function init() {
  const info = await window.godiv.getAppInfo();
  $('app-version').textContent = window.godiv.appVersion || `v${info.version}`;

  settings = await window.godiv.getSettings();
  $('save-root').value = settings.saveRoot || info.defaultSaveRoot;
  if (settings.lastFolderName) $('folder-name').placeholder = `최근: ${settings.lastFolderName}`;

  // URL 입력 → 실시간 뱃지
  $('url-input').addEventListener('input', (e) => updateBadge(e.target.value));

  // 저장 루트 변경
  $('pick-root-btn').addEventListener('click', async () => {
    const picked = await window.godiv.selectFolder();
    if (picked) {
      $('save-root').value = picked;
      settings = await window.godiv.saveSettings({ saveRoot: picked });
      toast('저장 루트 변경됨');
    }
  });

  // 다운로드
  $('download-btn').addEventListener('click', onDownload);

  // 키워드 검색 폴백
  $('keyword-search-btn').addEventListener('click', onKeywordSearch);

  // 캔버스 툴
  $('zoom-in-btn').addEventListener('click', () => setZoomLabel(canvas.setZoom(canvas.getZoom() + 0.1)));
  $('zoom-out-btn').addEventListener('click', () => setZoomLabel(canvas.setZoom(canvas.getZoom() - 0.1)));
  $('zoom-reset-btn').addEventListener('click', () => setZoomLabel(canvas.resetZoom()));
  $('select-all-btn').addEventListener('click', () => canvas.selectAll());
  $('clear-sel-btn').addEventListener('click', () => canvas.clearSelection());
  $('merge-btn').addEventListener('click', () => mergeItems(canvas.getSelected(), canvas));
  $('open-folder-btn').addEventListener('click', () => {
    if (canvas.folderPath) window.godiv.openFolder(canvas.folderPath);
  });

  // 업로드 스텁
  $('to-goditor-btn').addEventListener('click', () => toast('고디터 업로드 — MCP 연동 예정 (v2)'));
  $('to-figma-btn').addEventListener('click', () => toast('피그마 업로드 — MCP 연동 예정 (v2)'));

  // 캔버스 패널 접기/펼치기 (기본 접힘 — 다운로드가 주, 편집은 필요할 때)
  const layoutEl = document.querySelector('.layout');
  let canvasCollapsed = settings.canvasCollapsed !== false;
  const applyCanvasCollapsed = (persist) => {
    layoutEl.classList.toggle('canvas-collapsed', canvasCollapsed);
    $('canvas-toggle').textContent = canvasCollapsed ? '🖼 캔버스 펼치기' : '🖼 캔버스 접기';
    if (persist) window.godiv.setCanvasCollapsed(canvasCollapsed);
  };
  $('canvas-toggle').addEventListener('click', () => {
    canvasCollapsed = !canvasCollapsed;
    applyCanvasCollapsed(true);
  });
  applyCanvasCollapsed(false); // 초기 상태 반영(창 폭은 main이 시작 시 이미 컴팩트로 설정)

  // CDP 모드 토글 (봇차단 우회 — 로그인된 실제 크롬에 attach)
  if (settings.crawl?.mode === 'cdp') { $('cdp-toggle').checked = true; $('cdp-port').value = settings.crawl.cdpPort || ''; }
  const applyCrawlMode = () => {
    const on = $('cdp-toggle').checked;
    const port = parseInt($('cdp-port').value.trim(), 10) || 0;
    if (on && !port) { toast('CDP 포트를 입력하세요'); return; }
    window.godiv.setCrawlMode(on ? { mode: 'cdp', cdpPort: port } : { mode: 'launch', cdpPort: 0 });
    toast(on ? `CDP 모드 ON (포트 ${port})` : 'CDP 모드 OFF (전용 프로필)');
  };
  $('cdp-toggle').addEventListener('change', applyCrawlMode);
  $('cdp-port').addEventListener('change', () => { if ($('cdp-toggle').checked) applyCrawlMode(); });

  // 진행 이벤트
  window.godiv.onDownloadProgress((data) => {
    if (data.message) log(data.message);
    if (data.total) setProgress((data.current / data.total) * 100);
  });

  // 업데이트 상태 → 라벨칩 옆 뱃지
  window.godiv.onUpdateStatus(({ status, data }) => {
    const badge = $('update-badge');
    if (status === 'update-available') {
      badge.textContent = `업데이트 ${data.latest}`;
      badge.classList.remove('hidden');
      badge.onclick = () => data.releaseUrl && window.godiv.openExternal(data.releaseUrl);
    }
  });

  updateBadge('');

  // 테스트/자동화 훅 — 실제 앱 인스턴스에 붙는 내부 핸들(프로덕션 동작 영향 없음)
  window.__godiv = { canvas, updateBadge, toast, $, get platform() { return currentPlatform; } };
}

function setZoomLabel(z) { $('zoom-level').textContent = `${Math.round(z * 100)}%`; }

// ── 다운로드 실행 ─────────────────────────────────────────────
async function onDownload() {
  const url = $('url-input').value.trim();
  if (!url) return toast('URL을 입력하세요');
  if (currentPlatform === 'unknown') return toast('지원하지 않는 URL입니다 (네이버/쿠팡/와디즈)');

  const folderName = $('folder-name').value.trim();
  const btn = $('download-btn');
  btn.disabled = true;
  btn.textContent = '다운로드 중…';
  $('log').textContent = '';
  setProgress(0);
  log(`[${currentPlatform}] 다운로드 시작…`);

  try {
    const res = await window.godiv.downloadDetail({
      url,
      platform: currentPlatform,
      folderName: folderName || undefined,
      saveRoot: $('save-root').value,
    });
    if (!res.success) { log(`실패: ${res.error}`); toast('다운로드 실패'); return; }
    log(`완료: ${res.count}개 → ${res.folderPath}`);
    setProgress(100);
    await window.godiv.saveSettings({ lastFolderName: res.folderName || folderName });
    await canvas.loadFolder(res.folderPath);
    // 다운로드 결과를 바로 보도록 캔버스가 접혀 있으면 자동 펼침
    if (document.querySelector('.layout').classList.contains('canvas-collapsed')) $('canvas-toggle').click();
    toast(`${res.count}개 이미지 다운로드 완료`);
  } catch (err) {
    log(`오류: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '상세페이지 다운로드';
  }
}

// ── 네이버 키워드 검색 폴백 ───────────────────────────────────
async function onKeywordSearch() {
  const keyword = $('keyword-input').value.trim();
  if (!keyword) return toast('키워드를 입력하세요');
  const ul = $('keyword-results');
  ul.innerHTML = '<li>검색 중…</li>';
  try {
    const res = await window.godiv.naverKeywordSearch(keyword);
    if (!res.success) { ul.innerHTML = `<li>실패: ${res.error}</li>`; return; }
    ul.innerHTML = '';
    for (const item of res.items || []) {
      // 원격 데이터는 textContent/검증된 src로만 삽입(innerHTML XSS 방지)
      const li = document.createElement('li');
      if (item.thumbnail && /^https?:\/\//i.test(item.thumbnail)) {
        const img = document.createElement('img');
        img.src = item.thumbnail;
        li.appendChild(img);
      }
      const meta = document.createElement('div');
      meta.className = 'kw-meta';
      const titleDiv = document.createElement('div');
      titleDiv.textContent = item.title || '(제목 없음)';
      const reviewDiv = document.createElement('div');
      reviewDiv.className = 'kw-review';
      reviewDiv.textContent = `리뷰 ${item.reviewCount ?? '?'}`;
      meta.append(titleDiv, reviewDiv);
      li.appendChild(meta);
      // 유효한 http(s) URL만 선택 허용
      const safeUrl = /^https?:\/\//i.test(item.url || '') ? item.url : '';
      li.addEventListener('click', () => {
        if (!safeUrl) return toast('유효하지 않은 상품 URL');
        $('url-input').value = safeUrl;
        updateBadge(safeUrl);
        toast('URL 선택됨 — 다운로드 버튼을 누르세요');
      });
      ul.appendChild(li);
    }
    if (!ul.children.length) ul.innerHTML = '<li>결과 없음</li>';
  } catch (err) {
    ul.innerHTML = `<li>오류: ${err.message}</li>`;
  }
}

init();
