// canvas.js — 캔버스 패널 컨트롤러 (폴더 이미지 세로 나열, 스크롤/줌, 선택, 삭제)
// slice/merge/gif 훅 연동. GIF 선택프레임은 reload 후에도 이름 기준으로 복원한다.
import { enableSlice } from './slice.js';
import { isGifItem, openGifViewer } from './gif.js';

export function createCanvasController({ stageEl, scrollEl, folderLabelEl, onSelectionChange }) {
  let zoom = 1;
  let folderPath = '';
  let items = []; // { name, path, ext, isGif, el, imgEl, selected, dataUrl, gifFrameDataUrl? }
  let loadToken = 0; // loadFolder 경합 방지 토큰
  // GIF 이름 → 선택 프레임 dataURL. reload로 item이 재생성돼도 유지(합치기에서 정지프레임 사용).
  const gifFrames = new Map();

  function applyZoom() {
    stageEl.style.transform = `scale(${zoom})`;
  }

  function emitSelection() {
    onSelectionChange?.(items.filter((i) => i.selected));
  }

  // 빈 캔버스 안내 표시/숨김
  function updateEmptyGuide() {
    let guide = stageEl.querySelector('.canvas-empty-guide');
    if (items.length === 0) {
      if (!guide) {
        guide = document.createElement('div');
        guide.className = 'canvas-empty-guide';
        guide.innerHTML =
          '<div class="ceg-icon">🖼️</div>' +
          '<div class="ceg-title">아직 불러온 이미지가 없어요</div>' +
          '<div class="ceg-sub">URL을 붙여넣고 <b>상세페이지 다운로드</b>를 누르거나,<br>' +
          '이미 받은 폴더는 <b>폴더 열기</b> 옆에서 불러올 수 있어요.</div>';
        stageEl.appendChild(guide);
      }
    } else if (guide) {
      guide.remove();
    }
  }

  function makeItem(meta, dataUrl) {
    const el = document.createElement('div');
    el.className = 'canvas-item';
    el.dataset.name = meta.name;

    const img = document.createElement('img');
    img.src = dataUrl;
    img.draggable = false;
    el.appendChild(img);

    const item = { ...meta, el, imgEl: img, selected: false, dataUrl };
    // reload 전에 이 GIF의 선택 프레임이 있었으면 복원
    if (gifFrames.has(meta.name)) item.gifFrameDataUrl = gifFrames.get(meta.name);

    // 선택 (클릭). shift/cmd = 다중선택 유지
    el.addEventListener('click', (e) => {
      if (e.target.closest('.item-tools')) return; // 툴버튼 클릭은 선택 토글 제외
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        items.forEach((i) => { if (i !== item) { i.selected = false; i.el.classList.remove('selected'); } });
      }
      item.selected = !item.selected;
      el.classList.toggle('selected', item.selected);
      emitSelection();
    });

    // 툴 버튼 (✂ 슬라이스 / GIF 프레임 / ✕ 삭제)
    const tools = document.createElement('div');
    tools.className = 'item-tools';

    const sliceBtn = document.createElement('button');
    sliceBtn.className = 'btn btn-icon slice-btn';
    sliceBtn.textContent = '✂';
    sliceBtn.title = '가로로 자르기';
    sliceBtn.addEventListener('click', (e) => { e.stopPropagation(); enableSlice(item, controller); });
    tools.appendChild(sliceBtn);

    if (isGifItem(item)) {
      const gifBtn = document.createElement('button');
      gifBtn.className = 'btn btn-icon gif-btn';
      gifBtn.textContent = 'GIF';
      gifBtn.title = 'GIF 프레임 선택';
      gifBtn.addEventListener('click', (e) => { e.stopPropagation(); openGifViewer(item, controller); });
      tools.appendChild(gifBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-icon del-btn';
    delBtn.textContent = '✕';
    delBtn.title = '이 이미지 삭제';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await controller.deleteItem(item);
    });
    tools.appendChild(delBtn);

    el.appendChild(tools);
    return item;
  }

  const controller = {
    get folderPath() { return folderPath; },
    get items() { return items; },

    async loadFolder(fp) {
      // 로드 토큰: 겹쳐 호출되면 최신 로드만 stage에 반영(오래된 결과가 뒤늦게 append되지 않도록)
      const token = ++loadToken;
      folderPath = fp;
      stageEl.innerHTML = '';
      items = [];
      folderLabelEl.textContent = fp;
      const res = await window.godiv.listFolderImages(fp);
      if (token !== loadToken) return; // 더 새로운 로드가 시작됨 → 폐기
      if (!res.success) { folderLabelEl.textContent = `로드 실패: ${res.error}`; updateEmptyGuide(); return; }
      // 사라진 파일의 GIF 프레임 캐시 정리
      const names = new Set(res.images.map((m) => m.name));
      for (const key of [...gifFrames.keys()]) if (!names.has(key)) gifFrames.delete(key);
      for (const meta of res.images) {
        const durRes = await window.godiv.readImageDataUrl(meta.path);
        if (token !== loadToken) return; // 도중에 새 로드 시작 → 중단
        if (!durRes.success) continue;
        const item = makeItem(meta, durRes.dataUrl);
        items.push(item);
        stageEl.appendChild(item.el);
      }
      if (token !== loadToken) return;
      updateEmptyGuide();
      emitSelection();
    },

    // 슬라이스/합치기 결과로 캔버스 갱신
    async reload() { if (folderPath) await this.loadFolder(folderPath); },

    // GIF 선택 프레임 등록 (gif.js onExport에서 호출). reload 후에도 복원됨.
    setGifFrame(name, dataUrl) {
      if (name && dataUrl) gifFrames.set(name, dataUrl);
    },

    // 개별 이미지 삭제 (userlens 최우선 요청)
    async deleteItem(item) {
      if (!item) return { success: false };
      const res = await window.godiv.deleteImage({ folderPath, fileName: item.name });
      if (!res.success) { window.__godivToast?.(`삭제 실패: ${res.error}`); return res; }
      gifFrames.delete(item.name);
      await this.reload();
      window.__godivToast?.(`삭제됨 → ${item.name}`);
      return res;
    },

    setZoom(z) { zoom = Math.max(0.2, Math.min(3, z)); applyZoom(); return zoom; },
    resetZoom() { zoom = 1; applyZoom(); return zoom; },
    getZoom() { return zoom; },
    getSelected() { return items.filter((i) => i.selected); },
    selectAll() { items.forEach((i) => { i.selected = true; i.el.classList.add('selected'); }); emitSelection(); },
    clearSelection() { items.forEach((i) => { i.selected = false; i.el.classList.remove('selected'); }); emitSelection(); },
    emitSelection,
  };

  return controller;
}
