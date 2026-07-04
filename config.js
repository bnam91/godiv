// config.js — 앱 설정 persist (저장 루트, 마지막 폴더명, 창 크기 등)
// electron-store 없이 userData/settings.json 로 직접 관리 (의존성 최소화)
import { app } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 기본 저장 루트: ~/Downloads/div_download  (div_download 스킬과 동일 규칙)
export const DEFAULT_SAVE_ROOT = join(homedir(), 'Downloads', 'div_download');

function settingsPath() {
  // app.getPath 는 앱 ready 이후에만 안전 → userData 하위에 저장
  const base = app?.getPath ? app.getPath('userData') : join(__dirname, '.godiv');
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return join(base, 'settings.json');
}

const DEFAULTS = {
  saveRoot: DEFAULT_SAVE_ROOT,
  lastFolderName: '',
  canvasCollapsed: true, // 캔버스 패널 기본 접힘(다운로드가 주, 편집은 필요할 때 펼침)
  window: { width: 1180, height: 900 },
};

export function loadSettings() {
  try {
    const p = settingsPath();
    if (!existsSync(p)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    return { ...DEFAULTS, ...raw, window: { ...DEFAULTS.window, ...(raw.window || {}) } };
  } catch (e) {
    console.error('[config] loadSettings 실패, 기본값 사용:', e.message);
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  try {
    const current = loadSettings();
    // window는 얕은 병합 시 부분 patch(예: width만)가 height를 날림 → deep-merge
    const next = {
      ...current,
      ...patch,
      window: { ...current.window, ...(patch?.window || {}) },
    };
    // 원자적 저장: tmp에 쓰고 rename (쓰기 중 크래시로 인한 truncate 방지)
    const p = settingsPath();
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
    renameSync(tmp, p);
    return next;
  } catch (e) {
    console.error('[config] saveSettings 실패:', e.message);
    return null;
  }
}
