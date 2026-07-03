import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { listImages, saveImage, readImageAsDataUrl, deleteImage } from '../electron/services/imageStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTDIR = process.env.GODIV_QA_DIR;

function reg() {
  ipcMain.handle('list-folder-images', async (e, fp) => { try { return { success: true, images: await listImages(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('read-image-dataurl', async (e, fp) => { try { return { success: true, dataUrl: await readImageAsDataUrl(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('save-image', async (e, { folderPath, fileName, dataUrl }) => { try { return { success: true, path: await saveImage(folderPath, fileName, dataUrl) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('delete-image', async (e, { folderPath, fileName }) => { try { return { success: true, path: await deleteImage(folderPath, fileName) }; } catch (err) { return { success: false, error: err.message }; } });
}

app.whenReady().then(async () => {
  reg();
  const win = new BrowserWindow({ width: 1000, height: 800, show: false, webPreferences: { preload: join(__dirname, '..', 'preload.mjs'), contextIsolation: true, sandbox: false } });
  const errs = [];
  win.webContents.on('console-message', (_e, l, m) => { if (l >= 2) errs.push(m); });
  await win.loadFile(join(__dirname, 'feature-qa.html'));
  await new Promise(r => setTimeout(r, 400));
  try {
    const res = await win.webContents.executeJavaScript(`window.runFeatureQA(${JSON.stringify(TESTDIR)})`);
    console.log('QA_RESULT:' + JSON.stringify({ ...res, consoleErrors: errs }));
  } catch (e) { console.log('QA_RESULT:' + JSON.stringify({ fatal: e.message, stack: e.stack, consoleErrors: errs })); }
  finally { app.quit(); }
});
