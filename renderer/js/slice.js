// slice.js — 가로 절단선 슬라이스 (항목10).
// item 위에 가로 절단선을 띄우고 mousemove로 y(ratio 0.02~0.98)를 실시간 미리보기 →
// 클릭 확정 시 원본 픽셀(naturalWidth/Height) 기준으로 위/아래 두 PNG를 만들어
// window.godiv.saveImage 로 같은 폴더에 NN_a.png / NN_b.png 저장 후 controller.reload().
// Esc / 바깥 클릭이면 취소.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 원본 stem 기준으로 충돌하지 않는 (a, b) 파일명 쌍을 고른다.
function pickSlicePair(existingNames, stem) {
  let suffix = '';
  let n = 1;
  while (true) {
    const a = `${stem}${suffix}_a.png`;
    const b = `${stem}${suffix}_b.png`;
    if (!existingNames.has(a) && !existingNames.has(b)) return { a, b };
    n += 1;
    suffix = `_${n}`;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = src;
  });
}

// ratio(0~1) 위치에서 가로로 잘라 위/아래 두 PNG dataURL 반환 (원본 픽셀 기준)
async function sliceHorizontal(src, ratio) {
  const img = await loadImage(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const cutY = clamp(Math.round(H * ratio), 1, H - 1);
  const mk = (sy, sh) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = sh;
    cv.getContext('2d').drawImage(img, 0, sy, W, sh, 0, 0, W, sh);
    return cv.toDataURL('image/png');
  };
  return { top: mk(0, cutY), bottom: mk(cutY, H - cutY) };
}

export function enableSlice(item, controller) {
  if (!item || item._sliceActive) return;
  item._sliceActive = true;

  const el = item.el;
  el.classList.add('slice-mode');

  const line = document.createElement('div');
  line.className = 'slice-line';
  line.style.cssText =
    'position:absolute;left:0;right:0;top:50%;height:0;border-top:2px dashed #ff375f;' +
    'box-shadow:0 0 0 9999px rgba(0,0,0,0);pointer-events:none;z-index:50;';
  el.appendChild(line);

  let ratio = 0.5;

  const onMove = (e) => {
    const rect = el.getBoundingClientRect();
    ratio = clamp((e.clientY - rect.top) / rect.height, 0.02, 0.98);
    line.style.top = `${ratio * 100}%`;
  };

  let outsideTimer = null;
  const cleanup = () => {
    el.classList.remove('slice-mode');
    line.remove();
    el.removeEventListener('mousemove', onMove);
    el.removeEventListener('click', onConfirm, true);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onOutside, true);
    if (outsideTimer) { clearTimeout(outsideTimer); outsideTimer = null; }
    item._sliceActive = false;
  };

  const onConfirm = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const r = ratio;
    cleanup();
    try {
      const { top, bottom } = await sliceHorizontal(item.dataUrl || item.imgEl.src, r);
      const stem = (item.name || 'img').replace(/\.[^.]+$/, '');
      const names = new Set(controller.items.map((i) => i.name));
      const { a, b } = pickSlicePair(names, stem);
      const fp = controller.folderPath;
      const resA = await window.godiv.saveImage({ folderPath: fp, fileName: a, dataUrl: top });
      const resB = await window.godiv.saveImage({ folderPath: fp, fileName: b, dataUrl: bottom });
      if (!resA.success || !resB.success) {
        window.__godivToast?.(`슬라이스 저장 실패: ${resA.error || resB.error}`);
        return;
      }
      await controller.reload();
      window.__godivToast?.(`✂ 슬라이스 완료 → ${a} / ${b}`);
    } catch (err) {
      window.__godivToast?.(`슬라이스 실패: ${err.message}`);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Escape') cleanup();
  };

  const onOutside = (e) => {
    if (!el.contains(e.target)) cleanup();
  };

  el.addEventListener('mousemove', onMove);
  el.addEventListener('click', onConfirm, true);
  document.addEventListener('keydown', onKey);
  // 진입 유발 클릭과 충돌 방지 — 다음 tick에 바깥 클릭 감시 등록.
  // 빠르게 취소되면 cleanup에서 이 타이머를 취소해 리스너가 뒤늦게 붙지 않게 한다.
  outsideTimer = setTimeout(() => {
    outsideTimer = null;
    if (item._sliceActive) document.addEventListener('mousedown', onOutside, true);
  }, 0);

  window.__godivToast?.('가로 절단선을 옮긴 뒤 클릭해 자르세요 (Esc 취소)');
}
