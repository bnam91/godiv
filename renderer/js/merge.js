// merge.js — 다중선택 세로 합치기 (항목11).
// 선택 아이템들을 화면 순서(위→아래 = items 배열 순서)대로 세로로 이어 붙인다.
// 폭은 최대폭 기준으로 각 이미지를 비율유지 스케일 정규화 → 하나의 canvas에 순서대로 세로 배치.
// GIF는 gifFrameDataUrl(선택 프레임 정지이미지)이 있으면 그걸, 없으면 원본(첫 프레임 표시)을 사용.
// 결과 PNG를 window.godiv.saveImage 로 merged_NN.png 저장 후 controller.reload().
//
// ★캔버스 높이 한계: Chromium canvas는 ~65535px 초과 시 toDataURL이 "data:," 를 조용히 반환한다.
//   총높이가 한계를 넘으면 여러 파일(merged_01, merged_02 …)로 자동 분할해 저장한다.

const MAX_CANVAS_H = 65500; // 65535 안전 마진

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = src;
  });
}

// merged_NN.png 중 비어있는 번호 탐색 (2자리 zero-pad). usedExtra로 같은 배치 내 중복 방지.
function pickMergedName(existingNames, usedExtra) {
  let n = 1;
  for (;;) {
    const name = `merged_${String(n).padStart(2, '0')}.png`;
    if (!existingNames.has(name) && !usedExtra.has(name)) { usedExtra.add(name); return name; }
    n += 1;
  }
}

// scaled 이미지 배열 중 [start..) 를 한 캔버스에 세로로 그려 PNG dataURL 반환.
// 반환: { dataUrl, nextIndex } — nextIndex는 아직 안 담긴 다음 이미지 인덱스.
function renderChunk(scaled, maxW, start) {
  // 이 청크에 담을 이미지 범위 결정(총높이 ≤ MAX). 단일 이미지가 MAX보다 크면 그 하나는 잘려도 담는다.
  let h = 0;
  let end = start;
  while (end < scaled.length) {
    const next = h + scaled[end].h;
    if (end > start && next > MAX_CANVAS_H) break;
    h = next;
    end += 1;
    if (h >= MAX_CANVAS_H) break;
  }
  const chunkH = Math.min(h, MAX_CANVAS_H);
  const cv = document.createElement('canvas');
  cv.width = maxW;
  cv.height = chunkH;
  const ctx = cv.getContext('2d');
  let y = 0;
  for (let i = start; i < end; i++) {
    const s = scaled[i];
    ctx.drawImage(s.im, 0, 0, s.im.naturalWidth, s.im.naturalHeight, 0, y, s.w, s.h);
    y += s.h;
  }
  return { dataUrl: cv.toDataURL('image/png'), nextIndex: end };
}

export async function mergeItems(items, controller) {
  if (!items || items.length < 2) {
    window.__godivToast?.('합치려면 2개 이상 선택하세요');
    return;
  }

  try {
    window.__godivToast?.(`합치는 중… (${items.length}장)`); // 세로 긴 이미지 다수면 잠시 걸림
    // 각 아이템 소스: GIF는 선택 프레임 우선, 그 외 원본
    const sources = items.map((it) => it.gifFrameDataUrl || it.dataUrl || it.imgEl.src);
    const imgs = await Promise.all(sources.map(loadImage));

    const maxW = Math.max(...imgs.map((im) => im.naturalWidth));
    const scaled = imgs.map((im) => {
      const w = maxW;
      const h = Math.max(1, Math.round(im.naturalHeight * (maxW / im.naturalWidth)));
      return { im, w, h };
    });
    const totalH = scaled.reduce((sum, s) => sum + s.h, 0);

    const names = new Set(controller.items.map((i) => i.name));
    const usedExtra = new Set();
    const savedFiles = [];

    // 총높이가 한계 이하면 단일 파일, 초과면 자동 분할
    let idx = 0;
    let guardChunks = 0;
    while (idx < scaled.length) {
      if (++guardChunks > 500) throw new Error('분할 청크가 너무 많습니다');
      const { dataUrl, nextIndex } = renderChunk(scaled, maxW, idx);
      if (!dataUrl || dataUrl.length < 32) {
        throw new Error('캔버스 렌더 실패(이미지가 너무 큽니다)');
      }
      const fileName = pickMergedName(names, usedExtra);
      const res = await window.godiv.saveImage({ folderPath: controller.folderPath, fileName, dataUrl });
      if (!res.success) { window.__godivToast?.(`합치기 저장 실패: ${res.error}`); return; }
      savedFiles.push(fileName);
      idx = nextIndex;
    }

    await controller.reload();
    if (savedFiles.length === 1) {
      window.__godivToast?.(`합치기 완료 → ${savedFiles[0]} (${items.length}장)`);
    } else {
      window.__godivToast?.(
        `합치기 완료 → ${savedFiles.length}개 파일로 분할 저장 (총높이 ${totalH}px > 한계 ${MAX_CANVAS_H}px)`
      );
    }
  } catch (err) {
    window.__godivToast?.(`합치기 실패: ${err.message}`);
  }
}
