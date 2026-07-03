// merge.js — 다중선택 세로 합치기 (항목11).
// 선택 아이템들을 화면 순서(위→아래 = items 배열 순서)대로 세로로 이어 붙인다.
// 폭은 최대폭 기준으로 각 이미지를 비율유지 스케일 정규화 → 하나의 canvas에 순서대로 세로 배치.
// GIF는 gifFrameDataUrl(선택 프레임 정지이미지)이 있으면 그걸, 없으면 원본(첫 프레임 표시)을 사용.
// 결과 PNG를 window.godiv.saveImage 로 merged_NN.png 저장 후 controller.reload().

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = src;
  });
}

// merged_NN.png 중 비어있는 번호 탐색 (2자리 zero-pad)
function pickMergedName(existingNames) {
  let n = 1;
  while (true) {
    const name = `merged_${String(n).padStart(2, '0')}.png`;
    if (!existingNames.has(name)) return name;
    n += 1;
  }
}

export async function mergeItems(items, controller) {
  if (!items || items.length < 2) {
    window.__godivToast?.('합치려면 2개 이상 선택하세요');
    return;
  }

  try {
    // 각 아이템 소스: GIF는 선택 프레임 우선, 그 외 원본
    const sources = items.map((it) => it.gifFrameDataUrl || it.dataUrl || it.imgEl.src);
    const imgs = await Promise.all(sources.map(loadImage));

    const maxW = Math.max(...imgs.map((im) => im.naturalWidth));
    const scaled = imgs.map((im) => {
      const w = maxW;
      const h = Math.round(im.naturalHeight * (maxW / im.naturalWidth));
      return { im, w, h };
    });
    const totalH = scaled.reduce((sum, s) => sum + s.h, 0);

    const cv = document.createElement('canvas');
    cv.width = maxW;
    cv.height = totalH;
    const ctx = cv.getContext('2d');
    let y = 0;
    for (const s of scaled) {
      ctx.drawImage(s.im, 0, 0, s.im.naturalWidth, s.im.naturalHeight, 0, y, s.w, s.h);
      y += s.h;
    }
    const dataUrl = cv.toDataURL('image/png');

    const names = new Set(controller.items.map((i) => i.name));
    const fileName = pickMergedName(names);
    const res = await window.godiv.saveImage({
      folderPath: controller.folderPath,
      fileName,
      dataUrl,
    });
    if (!res.success) {
      window.__godivToast?.(`합치기 저장 실패: ${res.error}`);
      return;
    }
    await controller.reload();
    window.__godivToast?.(`합치기 완료 → ${fileName} (${items.length}장)`);
  } catch (err) {
    window.__godivToast?.(`합치기 실패: ${err.message}`);
  }
}
