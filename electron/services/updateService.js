// updateService.js — 자동업데이트 배선.
// [SCAFFOLD 최소구현] 항목14 에이전트가 module_update_auto(git reset 방식)로 확장한다.
// 현재: GitHub Releases API로 최신 태그 확인 → 렌더러에 update-status 전송(라벨/토스트용).
// 확장 시: submodules/module_update_auto/release_updater.js 연동, VERSION.txt 기반 git 업데이트.
import https from 'https';

function fetchLatestRelease(owner, repo) {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
        { headers: { 'User-Agent': 'godiv', Accept: 'application/vnd.github.v3+json' } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const r = JSON.parse(data);
              resolve({ tag_name: r.tag_name, html_url: r.html_url });
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on('error', reject);
  });
}

export async function checkForUpdates(win, packageJson, { manual = false } = {}) {
  const pub = packageJson?.build?.publish;
  if (!pub?.owner || !pub?.repo) {
    return { success: false, error: 'publish 설정 없음' };
  }
  const current = `v${packageJson.version}`;
  try {
    const latest = await fetchLatestRelease(pub.owner, pub.repo);
    const hasUpdate = latest.tag_name && latest.tag_name !== current;
    const status = hasUpdate ? 'update-available' : 'update-not-available';
    win?.webContents?.send('update-status', {
      status,
      data: { current, latest: latest.tag_name, releaseUrl: latest.html_url },
    });
    console.log(`[update] 현재 ${current} / 최신 ${latest.tag_name || '?'} → ${status}`);
    return { success: true, current, latest: latest.tag_name, hasUpdate };
  } catch (e) {
    if (manual) win?.webContents?.send('update-status', { status: 'error', data: { message: e.message } });
    console.log(`[update] 확인 실패(무시): ${e.message}`);
    return { success: false, error: e.message };
  }
}
