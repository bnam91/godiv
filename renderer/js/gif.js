// gif.js — GIF 프레임 뷰어 + 선택 프레임 PNG 내보내기 (항목12).
// 디코딩: WebCodecs ImageDecoder 사용 (Electron28/Chromium120 지원, 별도 의존성 없음).
//   new ImageDecoder({data, type:'image/gif'}) → tracks.ready → frameCount →
//   decode({frameIndex}) → VideoFrame → canvas.
// #gif-modal 슬라이더로 프레임 탐색, "이 프레임 PNG 저장" 시 {stem}_frameNN.png 저장 +
//   item.gifFrameDataUrl 에 저장(merge에서 재사용) → controller.reload().

export function isGifItem(item) {
  return !!item?.isGif || (item?.ext || '').toLowerCase() === '.gif';
}

function dataUrlToBytes(dataUrl) {
  const b64 = (dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function openGifViewer(item, controller) {
  const modal = document.getElementById('gif-modal');
  const preview = document.getElementById('gif-frame-preview');
  const slider = document.getElementById('gif-frame-slider');
  const label = document.getElementById('gif-frame-label');
  const exportBtn = document.getElementById('gif-export-btn');
  const closeBtn = document.getElementById('gif-close');
  if (!modal || !preview || !slider || !label || !exportBtn || !closeBtn) return;

  if (typeof ImageDecoder === 'undefined') {
    window.__godivToast?.('이 환경은 GIF 디코딩(ImageDecoder)을 지원하지 않습니다');
    return;
  }

  let decoder;
  let frameCount = 0;
  try {
    decoder = new ImageDecoder({ data: dataUrlToBytes(item.dataUrl || item.imgEl.src), type: 'image/gif' });
    await decoder.tracks.ready;
    frameCount = decoder.tracks.selectedTrack?.frameCount || 0;
    if (!frameCount) throw new Error('프레임 없음');
  } catch (err) {
    window.__godivToast?.(`GIF 디코딩 실패: ${err.message}`);
    return;
  }

  let current = 0;
  let renderSeq = 0;
  let currentCanvas = null; // 마지막으로 그린 프레임 canvas (저장용)

  async function renderFrame(i) {
    const seq = ++renderSeq;
    try {
      const { image } = await decoder.decode({ frameIndex: i });
      if (seq !== renderSeq) { image.close?.(); return; } // 슬라이더 연속 이동 시 최신만 반영
      const cv = document.createElement('canvas');
      cv.width = image.displayWidth || image.codedWidth;
      cv.height = image.displayHeight || image.codedHeight;
      cv.getContext('2d').drawImage(image, 0, 0);
      image.close?.();
      currentCanvas = cv;
      preview.innerHTML = '';
      preview.appendChild(cv);
      label.textContent = `${i + 1} / ${frameCount}`;
    } catch (err) {
      window.__godivToast?.(`프레임 렌더 실패: ${err.message}`);
    }
  }

  const onSlider = () => {
    current = Number(slider.value);
    renderFrame(current);
  };

  const onExport = async () => {
    if (!currentCanvas) return;
    try {
      const dataUrl = currentCanvas.toDataURL('image/png');
      const stem = (item.name || 'gif').replace(/\.[^.]+$/, '');
      const fileName = `${stem}_frame${String(current + 1).padStart(2, '0')}.png`;
      const res = await window.godiv.saveImage({
        folderPath: controller.folderPath,
        fileName,
        dataUrl,
      });
      if (!res.success) {
        window.__godivToast?.(`프레임 저장 실패: ${res.error}`);
        return;
      }
      item.gifFrameDataUrl = dataUrl; // 현재 item에 즉시 반영
      // reload 후에도 유지되도록 컨트롤러의 이름→프레임 맵에 등록(합치기에서 정지 이미지로 재사용)
      controller.setGifFrame?.(item.name, dataUrl);
      close();
      await controller.reload();
      window.__godivToast?.(`프레임 저장 완료 → ${fileName} (합치기 시 이 프레임 사용)`);
    } catch (err) {
      window.__godivToast?.(`프레임 저장 실패: ${err.message}`);
    }
  };

  const onBackdrop = (e) => {
    if (e.target === modal) close();
  };

  function close() {
    modal.classList.add('hidden');
    slider.removeEventListener('input', onSlider);
    exportBtn.removeEventListener('click', onExport);
    closeBtn.removeEventListener('click', close);
    modal.removeEventListener('mousedown', onBackdrop);
    try { decoder.close?.(); } catch (_) {}
  }

  slider.min = '0';
  slider.max = String(frameCount - 1);
  slider.value = '0';
  slider.addEventListener('input', onSlider);
  exportBtn.addEventListener('click', onExport);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('mousedown', onBackdrop);

  modal.classList.remove('hidden');
  await renderFrame(0);
}
