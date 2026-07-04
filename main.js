import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { loadSettings, saveSettings, DEFAULT_SAVE_ROOT } from './config.js';
import { downloadDetail, naverKeywordSearch, closeBrowser, setCrawlOptions } from './electron/services/browserService.js';
import { listImages, saveImage, readImageAsDataUrl, deleteImage } from './electron/services/imageStore.js';
import { detectPlatform } from './electron/services/platform.js';
import { checkForUpdates } from './electron/services/updateService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
const COMPACT_WIDTH = 412;                 // 캔버스 접힘 시 창 폭(좌패널만)
// 캔버스 접힘 상태(기본 접힘). resize persist가 접힘/펼침 폭을 구분하는 데 사용.
let canvasCollapsed = loadSettings().canvasCollapsed !== false;

console.log('\n========================================');
console.log(`📦 godiv v${packageJson.version}  (${process.platform}/${process.arch})`);
console.log('========================================\n');

function createWindow() {
  const settings = loadSettings();
  mainWindow = new BrowserWindow({
    // 캔버스 접힘(기본)이면 좌패널만 보이는 컴팩트 폭으로 시작
    width: canvasCollapsed ? COMPACT_WIDTH : (settings.window?.width || 1180),
    height: settings.window?.height || 900,
    minWidth: 412,   // 컴팩트(좌패널 380+여백) 허용
    minHeight: 640,
    title: `godiv v${packageJson.version}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !app.isPackaged,
    },
  });

  if (process.platform === 'win32') mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(join(__dirname, 'renderer/index.html'));

  // 창 크기 변경 persist (디바운스). 캔버스 펼침 상태의 폭만 저장(접힘 컴팩트폭은 저장 안 함).
  let resizeTimer = null;
  mainWindow.on('resize', () => {
    if (!mainWindow) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!mainWindow) return;
      const [width, height] = mainWindow.getSize();
      if (canvasCollapsed) saveSettings({ window: { height } });
      else saveSettings({ window: { width, height } });
    }, 400);
  });

  // 자동 업데이트 체크 (앱 시작 3초 후)
  setTimeout(() => {
    checkForUpdates(mainWindow, packageJson, { isDev, isPackaged: app.isPackaged }).catch((e) =>
      console.error('[update] 체크 실패:', e.message)
    );
  }, 3000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  createWindow();

  // ── 앱 정보 / 설정 ──────────────────────────────────────────
  ipcMain.handle('get-app-info', () => ({
    version: packageJson.version,
    platform: process.platform,
    arch: process.arch,
    defaultSaveRoot: DEFAULT_SAVE_ROOT,
  }));

  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (e, patch) => saveSettings(patch));

  // 캔버스 패널 접기/펼치기 → 창 폭 조절 + 상태 persist
  ipcMain.handle('set-canvas-collapsed', (e, collapsed) => {
    canvasCollapsed = !!collapsed;
    saveSettings({ canvasCollapsed });
    if (mainWindow) {
      const [, h] = mainWindow.getSize();
      if (canvasCollapsed) {
        mainWindow.setSize(COMPACT_WIDTH, h);
      } else {
        const s = loadSettings();
        const w = s.window?.width && s.window.width > 500 ? s.window.width : 1180;
        mainWindow.setSize(w, h);
      }
    }
    return { success: true, canvasCollapsed };
  });

  // 크롤 모드 토글 (launch=전용프로필 새로띄움 / cdp=실제 로그인 크롬에 attach)
  ipcMain.handle('set-crawl-mode', (e, opts) => {
    setCrawlOptions(opts);
    saveSettings({ crawl: opts });
    return { success: true };
  });

  // 저장된 크롤 모드 적용 (앱 시작 시)
  {
    const s = loadSettings();
    if (s.crawl) setCrawlOptions(s.crawl);
  }

  ipcMain.handle('select-folder', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '저장 루트 폴더 선택',
    });
    return !result.canceled && result.filePaths.length > 0 ? result.filePaths[0] : null;
  });

  ipcMain.handle('open-folder', async (e, folderPath) => {
    try {
      if (!folderPath) throw new Error('폴더 경로가 없습니다.');
      await shell.openPath(folderPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-external', async (e, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 플랫폼 판별 ─────────────────────────────────────────────
  ipcMain.handle('detect-platform', (e, url) => detectPlatform(url));

  // ── 상세페이지 다운로드 ─────────────────────────────────────
  // opts: { url, platform, folderName?, saveRoot? }
  ipcMain.handle('download-detail', async (e, opts) => {
    try {
      return await downloadDetail(opts || {}, e.sender);
    } catch (err) {
      console.error('[download-detail] 오류:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  // 네이버 키워드 검색 폴백: keyword → 상품 목록
  ipcMain.handle('naver-keyword-search', async (e, keyword) => {
    try {
      return await naverKeywordSearch(keyword, e.sender);
    } catch (err) {
      console.error('[naver-keyword-search] 오류:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  // ── 캔버스: 폴더 이미지 로딩 / 저장 ─────────────────────────
  ipcMain.handle('list-folder-images', async (e, folderPath) => {
    try {
      return { success: true, images: await listImages(folderPath) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('read-image-dataurl', async (e, filePath) => {
    try {
      return { success: true, dataUrl: await readImageAsDataUrl(filePath) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // dataURL(슬라이스/합치기/프레임 결과) → 파일 저장
  ipcMain.handle('save-image', async (e, { folderPath, fileName, dataUrl }) => {
    try {
      const savedPath = await saveImage(folderPath, fileName, dataUrl);
      return { success: true, path: savedPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 개별 이미지 삭제
  ipcMain.handle('delete-image', async (e, { folderPath, fileName }) => {
    try {
      const removed = await deleteImage(folderPath, fileName);
      return { success: true, path: removed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 업데이트 ────────────────────────────────────────────────
  ipcMain.handle('check-updates', async () => {
    try {
      return await checkForUpdates(mainWindow, packageJson, { isDev, isPackaged: app.isPackaged, manual: true });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[Main] IPC handlers registered');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await closeBrowser().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await closeBrowser().catch(() => {});
});
