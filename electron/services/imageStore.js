// imageStore.js — 로컬 이미지 파일 입출력 (캔버스 로딩/저장)
// 보안: 렌더러가 넘기는 경로/파일명은 신뢰하지 않는다.
//  - saveImage(fileName): 경로구분자/절대경로/.. 금지, 결과 경로가 폴더 안인지 확인
//  - readImageAsDataUrl(path): 허용된 루트(다운로드/로드한 폴더) 하위만 읽기 허용
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, resolve, basename, sep } from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// 렌더러에 노출을 허용하는 폴더 루트 화이트리스트. 폴더를 로드/다운로드할 때 등록된다.
const allowedRoots = new Set();

export function allowRoot(folderPath) {
  if (folderPath) allowedRoots.add(resolve(folderPath));
}

// resolvedPath가 등록된 허용 루트 중 하나의 하위(또는 자신)인지 검사.
function isUnderAllowedRoot(resolvedPath) {
  for (const root of allowedRoots) {
    if (resolvedPath === root || resolvedPath.startsWith(root + sep)) return true;
  }
  return false;
}

// 파일명이 안전한 단일 세그먼트인지 검사 (경로구분자/.. /절대경로 금지)
function assertSafeFileName(fileName) {
  const name = String(fileName || '');
  if (!name || name === '.' || name === '..') throw new Error('잘못된 파일명');
  if (name.includes('/') || name.includes('\\') || name.includes('\0'))
    throw new Error('파일명에 경로구분자를 쓸 수 없습니다');
  if (basename(name) !== name) throw new Error('파일명이 안전하지 않습니다');
  return name;
}

// 폴더 내 이미지 파일 목록 (이름 오름차순 = 다운로드 순번 순)
export async function listImages(folderPath) {
  if (!folderPath || !existsSync(folderPath)) return [];
  allowRoot(folderPath); // 로드한 폴더는 읽기 허용 루트로 등록
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

// 파일 → dataURL (canvas 로딩용; file:// CSP 우회). 허용 루트 하위 + 이미지 확장자만.
export async function readImageAsDataUrl(filePath) {
  const resolved = resolve(String(filePath || ''));
  const ext = extname(resolved).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) throw new Error('이미지 파일이 아닙니다');
  if (!isUnderAllowedRoot(resolved)) throw new Error('허용되지 않은 경로입니다');
  const mime = MIME[ext] || 'application/octet-stream';
  const buf = await readFile(resolved);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// dataURL → 파일 저장 (슬라이스/합치기/프레임 결과물). 원본 보존 위해 새 파일명 사용.
export async function saveImage(folderPath, fileName, dataUrl) {
  if (!folderPath) throw new Error('folderPath 없음');
  const safeName = assertSafeFileName(fileName);
  const root = resolve(folderPath);
  // 저장 대상 폴더도 허용 루트여야 함(임의 위치 쓰기 방지). 로드/다운로드한 폴더만 통과.
  if (!isUnderAllowedRoot(root)) {
    // folderPath 자신이 루트로 등록돼 있지 않으면 등록 시도 대신 거부
    throw new Error('허용되지 않은 저장 폴더입니다');
  }
  const dest = resolve(root, safeName);
  if (dest !== join(root, safeName) || !(dest === root || dest.startsWith(root + sep))) {
    throw new Error('저장 경로가 폴더를 벗어납니다');
  }
  if (!existsSync(root)) await mkdir(root, { recursive: true });
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('유효하지 않은 dataURL');
  const buf = Buffer.from(m[2], 'base64');
  await writeFile(dest, buf);
  return dest;
}
