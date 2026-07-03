// 범용 UI 드라이버 — 실제 renderer/index.html 을 진짜 preload로 로드하고,
// GODIV_SCENARIO 파일(JS)을 렌더러 컨텍스트에서 실행해 결과(JSON)를 출력한다.
// 시나리오 JS는 async IIFE 형태여야 하며 마지막에 값을 return 한다.
// 렌더러에서 쓸 수 있는 것: window.godiv(IPC), window.__godiv(canvas/updateBadge/toast/$), DOM.
// 사용: GODIV_SCENARIO=<file> arch -arm64 npx electron test/ui-drive.mjs
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { loadSettings, saveSettings, DEFAULT_SAVE_ROOT } from '../config.js';
import { listImages, saveImage, readImageAsDataUrl } from '../electron/services/imageStore.js';
import { detectPlatform } from '../electron/services/platform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO = process.env.GODIV_SCENARIO;
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

// main.js의 IPC 중 다운로드/업데이트를 뺀 나머지를 그대로 등록(크롤링 미포함).
function registerIpc() {
  ipcMain.handle('get-app-info', () => ({ version: packageJson.version, platform: process.platform, arch: process.arch, defaultSaveRoot: DEFAULT_SAVE_ROOT }));
  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (e, patch) => saveSettings(patch));
  ipcMain.handle('detect-platform', (e, url) => detectPlatform(url));
  ipcMain.handle('list-folder-images', async (e, fp) => { try { return { success: true, images: await listImages(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('read-image-dataurl', async (e, fp) => { try { return { success: true, dataUrl: await readImageAsDataUrl(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('save-image', async (e, { folderPath, fileName, dataUrl }) => { try { return { success: true, path: await saveImage(folderPath, fileName, dataUrl) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('select-folder', async () => process.env.GODIV_MOCK_PICK || null); // 다이얼로그 목킹
  ipcMain.handle('open-folder', async () => ({ success: true }));
  ipcMain.handle('open-external', async () => ({ success: true }));
  // 다운로드/키워드/업데이트는 시나리오에서 부르면 스텁 응답(크롤링 미수행)
  ipcMain.handle('download-detail', async () => ({ success: false, error: '[ui-drive] 다운로드는 이 하네스에서 미수행' }));
  ipcMain.handle('naver-keyword-search', async (e, kw) => ({ success: true, items: process.env.GODIV_MOCK_KWJSON ? JSON.parse(process.env.GODIV_MOCK_KWJSON) : [] }));
  ipcMain.handle('check-updates', async () => ({ success: true }));
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1180, height: 900, show: process.env.GODIV_SHOW === '1',
    webPreferences: { preload: join(__dirname, '..', 'preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  const consoleLogs = [];
  win.webContents.on('console-message', (_e, level, message) => {
    consoleLogs.push({ level, message });
    if (level >= 2) console.log('  RENDER_ERR>', message); // warning/error
  });

  await win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 800)); // init() 완료 대기

  try {
    const scenarioSrc = readFileSync(SCENARIO, 'utf-8');
    // 시나리오를 async 함수 본문으로 감싸 실행
    const wrapped = `(async () => { ${scenarioSrc} })()`;
    const result = await win.webContents.executeJavaScript(wrapped, true);
    console.log('UI_RESULT:' + JSON.stringify({ result, consoleErrors: consoleLogs.filter(l => l.level >= 2).map(l => l.message) }));
  } catch (e) {
    console.log('UI_RESULT:' + JSON.stringify({ fatal: e.message, consoleErrors: consoleLogs.filter(l => l.level >= 2).map(l => l.message) }));
  } finally {
    app.quit();
  }
});
