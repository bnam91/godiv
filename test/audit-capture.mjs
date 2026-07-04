// 디자인 감사용 스크린샷 하네스 — 실제 index.html 로드 후 여러 상태를 capturePage로 PNG 저장.
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { loadSettings, saveSettings, DEFAULT_SAVE_ROOT } from '../config.js';
import { listImages, saveImage, readImageAsDataUrl } from '../electron/services/imageStore.js';
import { detectPlatform } from '../electron/services/platform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.GODIV_OUT || '/private/tmp/claude-501/-Users-a1/c1988579-b742-488a-9bd7-18719dbfac3e/scratchpad';
const IMGDIR = '/Users/a1/Downloads/div_download/루메나_무선서큘레이터';
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

function registerIpc() {
  ipcMain.handle('get-app-info', () => ({ version: packageJson.version, platform: process.platform, arch: process.arch, defaultSaveRoot: DEFAULT_SAVE_ROOT }));
  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (e, patch) => saveSettings(patch));
  ipcMain.handle('detect-platform', (e, url) => detectPlatform(url));
  ipcMain.handle('list-folder-images', async (e, fp) => { try { return { success: true, images: await listImages(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('read-image-dataurl', async (e, fp) => { try { return { success: true, dataUrl: await readImageAsDataUrl(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('save-image', async () => ({ success: true, path: 'x' }));
  ipcMain.handle('delete-image', async () => ({ success: true, path: 'x' }));
  ipcMain.handle('select-folder', async () => null);
  ipcMain.handle('open-folder', async () => ({ success: true }));
  ipcMain.handle('open-external', async () => ({ success: true }));
  ipcMain.handle('download-detail', async () => ({ success: false, error: 'stub' }));
  ipcMain.handle('naver-keyword-search', async () => ({ success: true, items: [] }));
  ipcMain.handle('check-updates', async () => ({ success: true }));
}

async function shot(win, name) {
  const img = await win.capturePage();
  writeFileSync(join(OUT, name), img.toPNG());
  console.log('SHOT', name);
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1180, height: 900, show: false,
    webPreferences: { preload: join(__dirname, '..', 'preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  await win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 900));

  // (a) 빈 캔버스 초기
  await shot(win, 'a-empty.png');

  // 이미지 로드
  await win.webContents.executeJavaScript(`window.__godiv.canvas.loadFolder(${JSON.stringify(IMGDIR)})`, true);
  await new Promise((r) => setTimeout(r, 1500));
  await shot(win, 'b1-loaded.png');

  // (b) 첫 아이템 선택 + merge 버튼 활성화 유도(2개 선택)
  await win.webContents.executeJavaScript(`(() => {
    const items = window.__godiv.canvas.items;
    if(items[0]){ items[0].selected=true; items[0].el.classList.add('selected'); }
    if(items[1]){ items[1].selected=true; items[1].el.classList.add('selected'); }
    window.__godiv.canvas.emitSelection();
    // 첫 아이템 툴버튼 hover 상태 강제
    items[0]?.el.querySelector('.item-tools')?.style.setProperty('opacity','1');
    document.getElementById('canvas-scroll').scrollTop = 0;
  })()`, true);
  await new Promise((r) => setTimeout(r, 400));
  await shot(win, 'b2-selected.png');

  // (c) 토스트 표시
  await win.webContents.executeJavaScript(`window.__godivToast && window.__godivToast('합치는 중… (2장)')`, true);
  await new Promise((r) => setTimeout(r, 300));
  await shot(win, 'c-toast.png');

  // (d) GIF 모달 열기 (수동으로 클래스 제거 + 프리뷰에 이미지)
  await win.webContents.executeJavaScript(`(() => {
    const m = document.getElementById('gif-modal'); m.classList.remove('hidden');
    const p = document.getElementById('gif-frame-preview');
    const img = window.__godiv.canvas.items[0]?.el.querySelector('img');
    if(img){ const c=img.cloneNode(); p.innerHTML=''; p.appendChild(c); }
    document.getElementById('gif-frame-slider').max=12; document.getElementById('gif-frame-slider').value=3;
    document.getElementById('gif-frame-label').textContent='3 / 12';
  })()`, true);
  await new Promise((r) => setTimeout(r, 400));
  await shot(win, 'd-gif-modal.png');
  await win.webContents.executeJavaScript(`document.getElementById('gif-modal').classList.add('hidden')`, true);

  // (e) CDP details + keyword details 펼침 + platform badge + update badge
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.crawl-mode').open = true;
    document.getElementById('keyword-fallback').open = true;
    document.getElementById('platform-badge').textContent = '쿠팡';
    document.getElementById('url-input').value = 'https://www.coupang.com/vp/products/123456';
    const ub = document.getElementById('update-badge');
    ub.classList.remove('hidden'); ub.textContent='업데이트 v0.2.0 있음';
    document.getElementById('save-root').value = '/Users/a1/Downloads/div_download';
    // 로그에 텍스트
    document.getElementById('log').textContent = '[10:22:01] 크롤 시작\\n[10:22:03] 이미지 9장 감지\\n[10:22:05] 저장 완료';
    document.getElementById('progress-fill').style.width='60%';
    // disabled 버튼 상태 확인용: download 버튼 disable
    document.getElementById('merge-btn').disabled=false;
  })()`, true);
  await new Promise((r) => setTimeout(r, 400));
  await shot(win, 'e-left-expanded.png');

  // (f) 좁은 창 (minWidth 900)
  win.setSize(900, 760);
  await new Promise((r) => setTimeout(r, 500));
  await shot(win, 'f-narrow-900.png');

  // (g) 슬라이스 모드 (아이템에 slice-mode 클래스)
  win.setSize(1180, 900);
  await new Promise((r) => setTimeout(r, 300));
  await win.webContents.executeJavaScript(`(() => {
    const it = window.__godiv.canvas.items[0];
    if(it){ it.el.classList.add('slice-mode'); it.el.classList.add('selected'); }
  })()`, true);
  await new Promise((r) => setTimeout(r, 300));
  await shot(win, 'g-slice.png');

  app.quit();
});
