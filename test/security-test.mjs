// imageStore 보안 방어 단위테스트 (electron 없이 순수 모듈).
import { saveImage, readImageAsDataUrl, allowRoot, listImages } from '../electron/services/imageStore.js';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

const results = [];
function check(name, pass, detail = '') { results.push({ name, pass, detail }); }

const root = await mkdtemp(join(tmpdir(), 'godiv-sec-'));
const outside = await mkdtemp(join(tmpdir(), 'godiv-victim-'));
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

// 루트 등록 전: saveImage 거부되어야
try { await saveImage(root, 'a.png', tinyPng); check('등록전 저장 거부', false, '저장됨(취약)'); }
catch { check('등록전 저장 거부', true); }

allowRoot(root);

// 정상 저장
try { const p = await saveImage(root, '01.png', tinyPng); check('정상 저장', existsSync(p)); }
catch (e) { check('정상 저장', false, e.message); }

// 경로 traversal 파일명 차단
for (const bad of ['../escape.png', '../x.png', 'a/b.png', '/etc/evil.png', '..\\win.png', 'foo\0.png']) {
  try { await saveImage(root, bad, tinyPng); check(`traversal 차단: ${bad}`, false, '저장됨(취약!)'); }
  catch { check(`traversal 차단: ${bad}`, true); }
}

// 절대경로로 victim 폴더에 쓰기 시도 (fileName에 절대경로)
try { await saveImage(root, join(outside, 'pwn.png'), tinyPng); check('절대경로 파일명 차단', false, '저장됨(취약!)'); }
catch { check('절대경로 파일명 차단', true); }

// readImageAsDataUrl: 허용 루트 밖 임의 파일 읽기 차단
const secret = join(outside, 'secret.txt');
await writeFile(secret, 'TOP SECRET');
try { await readImageAsDataUrl(secret); check('임의파일 읽기 차단(비이미지)', false, '읽힘(취약!)'); }
catch { check('임의파일 읽기 차단(비이미지)', true); }

// 허용 루트 밖 이미지도 차단
const outImg = join(outside, 'out.png');
await writeFile(outImg, Buffer.from('x'));
try { await readImageAsDataUrl(outImg); check('루트밖 이미지 읽기 차단', false, '읽힘(취약!)'); }
catch { check('루트밖 이미지 읽기 차단', true); }

// 허용 루트 안 이미지는 정상 읽기
try { const d = await readImageAsDataUrl(join(root, '01.png')); check('루트안 이미지 읽기 OK', d.startsWith('data:image/png')); }
catch (e) { check('루트안 이미지 읽기 OK', false, e.message); }

await rm(root, { recursive: true, force: true });
await rm(outside, { recursive: true, force: true });

const passed = results.filter(r => r.pass).length;
console.log('SEC_RESULT:' + JSON.stringify({ passed, total: results.length, results }));
