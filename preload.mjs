import { contextBridge, ipcRenderer } from 'electron';

// 버전 라벨칩 — package.json 버전과 동기화 (릴리스 시 함께 갱신)
const appVersion = 'v0.1.0';

contextBridge.exposeInMainWorld('godiv', {
  appVersion,

  // 앱 정보 / 설정
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  setCrawlMode: (opts) => ipcRenderer.invoke('set-crawl-mode', opts),

  // 폴더 / 외부링크
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 플랫폼 판별
  detectPlatform: (url) => ipcRenderer.invoke('detect-platform', url),

  // 다운로드
  downloadDetail: (opts) => ipcRenderer.invoke('download-detail', opts),
  naverKeywordSearch: (keyword) => ipcRenderer.invoke('naver-keyword-search', keyword),

  // 캔버스 이미지
  listFolderImages: (folderPath) => ipcRenderer.invoke('list-folder-images', folderPath),
  readImageDataUrl: (filePath) => ipcRenderer.invoke('read-image-dataurl', filePath),
  saveImage: (payload) => ipcRenderer.invoke('save-image', payload),
  deleteImage: (payload) => ipcRenderer.invoke('delete-image', payload),

  // 업데이트
  checkUpdates: () => ipcRenderer.invoke('check-updates'),

  // 이벤트 수신
  onDownloadProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('download-progress', h);
    return () => ipcRenderer.removeListener('download-progress', h);
  },
  onUpdateStatus: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('update-status', h);
    return () => ipcRenderer.removeListener('update-status', h);
  },
});
