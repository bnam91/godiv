import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { listImages, saveImage, readImageAsDataUrl, deleteImage } from '../electron/services/imageStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTDIR = process.env.GODIV_FIX_TESTDIR;
const FN = process.env.GODIV_FIX_FN || 'runFixTests';

function reg() {
  ipcMain.handle('list-folder-images', async (e, fp) => { try { return { success: true, images: await listImages(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('read-image-dataurl', async (e, fp) => { try { return { success: true, dataUrl: await readImageAsDataUrl(fp) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('save-image', async (e, { folderPath, fileName, dataUrl }) => { try { return { success: true, path: await saveImage(folderPath, fileName, dataUrl) }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('delete-image', async (e, { folderPath, fileName }) => { try { return { success: true, path: await deleteImage(folderPath, fileName) }; } catch (err) { return { success: false, error: err.message }; } });
}

app.whenReady().then(async () => {
  reg();
  const win = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { preload: join(__dirname, '..', 'preload.mjs'), contextIsolation: true, sandbox: false } });
  win.webContents.on('console-message', (_e, l, m) => { if (m.includes('[toast]') || l >= 2) console.log('  R>', m); });
  await win.loadFile(join(__dirname, 'fixes-test.html'));
  await new Promise(r => setTimeout(r, 400));
  try {
    const res = await win.webContents.executeJavaScript(`window.${FN}(${JSON.stringify(TESTDIR)})`);
    console.log('FIX_RESULT:' + JSON.stringify(res));
  } catch (e) { console.log('FIX_RESULT:' + JSON.stringify({ fatal: e.message })); }
  finally { app.quit(); }
});
