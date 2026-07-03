// updateService.js — 자동업데이트 배선 (module_update_auto 연동).
// 흐름: VERSION.txt(또는 packageJson) 현재버전 ↔ GitHub 최신 릴리스 비교
//  → 새 버전이면 렌더러에 update-status 전송(뱃지) + 소스실행 시 dialog로 git 업데이트 확인.
//  ⚠️ 같은 버전이면 절대 git reset 하지 않는다.
import { dialog, app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import ReleaseUpdater from '../../submodules/module_update_auto/release_updater.js';
import updateConfig from '../../submodules/module_update_auto/config.js';

const execAsync = promisify(exec);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// git 저장소이며 워킹트리가 깨끗한지 확인(더티면 git reset로 로컬 변경 유실 → 거부).
async function isGitCleanSourceCheckout() {
  try {
    if (!existsSync(join(projectRoot, '.git'))) return { ok: false, reason: 'git 저장소 아님' };
    const { stdout } = await execAsync('git status --porcelain', { cwd: projectRoot });
    if (stdout.trim()) return { ok: false, reason: '로컬 변경사항 있음(더티 워킹트리)' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `git 확인 실패: ${e.message}` };
  }
}

// 통합 API 키 파일에서 GITHUB_TOKEN을 optional로 로드(없어도 공개레포라 동작).
// 토큰은 코드에 하드코딩하지 않고 env에서만 읽는다.
try {
  dotenv.config({ path: '/Users/a1/Documents/github_cloud/module_api_key/.env' });
} catch {
  // .env 없음 — 토큰 없이 진행
}

export async function checkForUpdates(win, packageJson, { isDev, isPackaged, manual = false } = {}) {
  const pub = packageJson?.build?.publish;
  if (!pub?.owner || !pub?.repo) {
    return { success: false, error: 'publish 설정 없음' };
  }

  const appVersion = `v${packageJson.version}`;
  const updater = new ReleaseUpdater(pub.owner, pub.repo, updateConfig.versionFile);

  try {
    // 현재 버전: VERSION.txt tag_name 우선, 없으면 앱 버전(packageJson)으로 대체.
    const currentTag = updater.getCurrentVersion();
    const current = currentTag || appVersion;

    const latest = await updater.getLatestRelease();
    if (!latest || !latest.tag_name) {
      console.log('[update] 최신 릴리스 정보를 가져오지 못했습니다.');
      if (manual) {
        win?.webContents?.send('update-status', { status: 'error', data: { message: '릴리스 정보 없음' } });
      }
      return { success: false, error: '릴리스 정보 없음' };
    }

    const hasUpdate = latest.tag_name !== current;
    const status = hasUpdate ? 'update-available' : 'update-not-available';

    win?.webContents?.send('update-status', {
      status,
      data: { current, latest: latest.tag_name, releaseUrl: latest.html_url },
    });
    console.log(`[update] 현재 ${current} / 최신 ${latest.tag_name} → ${status}`);

    if (!hasUpdate) {
      // 같은 버전 — git reset 절대 금지. 최신 버전 안내로 종료.
      return { success: true, current, latest: latest.tag_name, hasUpdate: false };
    }

    // git 기반 업데이트는 소스 실행(!isPackaged) + 깨끗한 git 체크아웃에서만 허용.
    // 패키징 앱이거나 더티/비-git이면 git reset로 로컬을 날리지 않고 릴리스 링크 안내만.
    if (isPackaged) {
      console.log('[update] 패키징 앱 — git 자동업데이트 스킵, 릴리스 링크 안내만.');
      return { success: true, current, latest: latest.tag_name, hasUpdate: true, updated: false, reason: 'packaged' };
    }
    const clean = await isGitCleanSourceCheckout();
    if (!clean.ok) {
      console.log(`[update] git 업데이트 불가(${clean.reason}) — 릴리스 링크 안내만.`);
      if (manual) {
        await dialog.showMessageBox(win, {
          type: 'info',
          title: '수동 업데이트 필요',
          message: `새 버전 ${latest.tag_name} 이 있습니다.`,
          detail: `자동 업데이트를 적용할 수 없습니다(${clean.reason}).\n릴리스 페이지에서 직접 받아주세요.`,
          buttons: ['확인'],
        });
      }
      return { success: true, current, latest: latest.tag_name, hasUpdate: true, updated: false, reason: clean.reason };
    }

    // 새 버전 감지 + 소스 실행 + 깨끗한 체크아웃 → git 기반 자동업데이트 진행.
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: '업데이트 알림',
      message: `새 버전이 있습니다: ${latest.tag_name}`,
      detail: `현재: ${current}\n\n지금 업데이트하시겠습니까?`,
      buttons: ['지금 업데이트', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response !== 0) {
      return { success: true, current, latest: latest.tag_name, hasUpdate: true, updated: false };
    }

    // git fetch --tags → main 복귀 → git reset --hard {tag} → npm install
    const ok = await updater.performUpdate(latest, `[${pub.owner}/${pub.repo}]`);
    if (!ok) {
      await dialog.showMessageBox(win, {
        type: 'error',
        title: '업데이트 실패',
        message: '업데이트 중 오류가 발생했습니다.',
        detail: '콘솔 로그를 확인하거나 나중에 다시 시도해주세요.',
        buttons: ['확인'],
      });
      return { success: false, error: '업데이트 실패', current, latest: latest.tag_name };
    }

    const { response: restartRes } = await dialog.showMessageBox(win, {
      type: 'info',
      title: '업데이트 완료',
      message: `${latest.tag_name} 업데이트가 완료됐습니다.`,
      detail: '변경사항을 적용하려면 앱을 재시작해야 합니다. 지금 재시작할까요?',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (restartRes === 0) {
      app.relaunch();
      app.exit(0);
    }

    return { success: true, current, latest: latest.tag_name, hasUpdate: true, updated: true };
  } catch (e) {
    if (manual) win?.webContents?.send('update-status', { status: 'error', data: { message: e.message } });
    console.log(`[update] 확인 실패(무시): ${e.message}`);
    return { success: false, error: e.message };
  }
}
