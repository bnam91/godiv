// 캔버스 편집 기능 통합 테스트 (main 프로세스). 실제 preload.mjs를 물린 hidden 창에서
// renderer 모듈(canvas/slice/merge/gif)을 구동해 실제 파일 생성까지 검증한다.
// 사용: GODIV_CANVAS_TESTDIR=<folder> arch -arm64 npx electron test/canvas-test.mjs
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { listImages, saveImage, readImageAsDataUrl } from '../electron/services/imageStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTDIR = process.env.GODIV_CANVAS_TESTDIR;

// main.js와 동일한 캔버스 IPC 핸들러 등록 (테스트에 필요한 것만)
function registerIpc() {
  ipcMain.handle('list-folder-images', async (e, fp) => {
    try { return { success: true, images: await listImages(fp) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('read-image-dataurl', async (e, fp) => {
    try { return { success: true, dataUrl: await readImageAsDataUrl(fp) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('save-image', async (e, { folderPath, fileName, dataUrl }) => {
    try { return { success: true, path: await saveImage(folderPath, fileName, dataUrl) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  // 스텁 (preload가 부르지만 테스트엔 불필요)
  ipcMain.handle('get-app-info', () => ({ version: '0.1.0', platform: process.platform, arch: process.arch, defaultSaveRoot: '' }));
  ipcMain.handle('get-settings', () => ({ saveRoot: '', lastFolderName: '' }));
  ipcMain.handle('save-settings', () => ({}));
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 900, height: 700, show: false,
    webPreferences: {
      preload: join(__dirname, '..', 'preload.mjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (message.includes('[toast]') || message.includes('Error') || message.includes('error'))
      console.log('  RENDERER>', message);
  });

  await win.loadFile(join(__dirname, 'canvas-test.html'));
  await new Promise(r => setTimeout(r, 500));

  try {
    const results = await win.webContents.executeJavaScript(`window.runCanvasTests(${JSON.stringify(TESTDIR)})`);
    console.log('CANVAS_RESULT:' + JSON.stringify(results));
  } catch (e) {
    console.log('CANVAS_RESULT:' + JSON.stringify({ fatal: e.message }));
  } finally {
    app.quit();
  }
});
