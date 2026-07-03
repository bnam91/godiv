// updateService.js — 자동업데이트 배선 (module_update_auto 연동).
// 흐름: VERSION.txt(또는 packageJson) 현재버전 ↔ GitHub 최신 릴리스 비교
//  → 새 버전이면 렌더러에 update-status 전송(뱃지) + 소스실행 시 dialog로 git 업데이트 확인.
//  ⚠️ 같은 버전이면 절대 git reset 하지 않는다.
import { dialog, app } from 'electron';
import dotenv from 'dotenv';
import ReleaseUpdater from '../../submodules/module_update_auto/release_updater.js';
import updateConfig from '../../submodules/module_update_auto/config.js';

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

    // 새 버전 감지: 소스 실행(npm run app)일 때 git 기반 자동업데이트 진행.
    // isPackaged여도 godiv는 현재 소스실행 위주라 동일 경로를 태우되,
    // git 저장소가 아니면 performUpdate가 내부에서 안전하게 실패(캐치)한다.
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
