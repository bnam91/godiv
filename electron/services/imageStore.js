// imageStore.js — 로컬 이미지 파일 입출력 (캔버스 로딩/저장)
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// 폴더 내 이미지 파일 목록 (이름 오름차순 = 다운로드 순번 순)
export async function listImages(folderPath) {
  if (!folderPath || !existsSync(folderPath)) return [];
  const entries = await readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && IMAGE_EXTS.has(extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => {
      const ext = extname(name).toLowerCase();
      return {
        name,
        path: join(folderPath, name),
        ext,
        isGif: ext === '.gif',
      };
    });
}

// 파일 → dataURL (canvas 로딩용; file:// CSP 우회)
export async function readImageAsDataUrl(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const buf = await readFile(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// dataURL → 파일 저장 (슬라이스/합치기/프레임 결과물). 원본 보존 위해 새 파일명 사용.
export async function saveImage(folderPath, fileName, dataUrl) {
  if (!folderPath) throw new Error('folderPath 없음');
  if (!existsSync(folderPath)) await mkdir(folderPath, { recursive: true });
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('유효하지 않은 dataURL');
  const buf = Buffer.from(m[2], 'base64');
  const dest = join(folderPath, fileName);
  await writeFile(dest, buf);
  return dest;
}
