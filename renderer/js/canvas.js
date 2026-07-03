// canvas.js — 캔버스 패널 컨트롤러 (항목9: 폴더 이미지 세로 나열, 스크롤/줌, 선택)
// 스캐폴드 기본 동작 포함. 항목10~12 에이전트가 slice/merge/gif 훅을 붙인다.
import { enableSlice } from './slice.js';
import { isGifItem, openGifViewer } from './gif.js';

export function createCanvasController({ stageEl, scrollEl, folderLabelEl, onSelectionChange }) {
  let zoom = 1;
  let folderPath = '';
  let items = []; // { name, path, ext, isGif, el, imgEl, selected, gifFrameDataUrl? }

  function applyZoom() {
    stageEl.style.transform = `scale(${zoom})`;
  }

  function emitSelection() {
    onSelectionChange?.(items.filter((i) => i.selected));
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

    // 선택 (클릭). shift/cmd = 다중선택 유지
    el.addEventListener('click', (e) => {
      if (e.target.closest('.slice-btn') || e.target.closest('.gif-btn')) return;
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        items.forEach((i) => { if (i !== item) { i.selected = false; i.el.classList.remove('selected'); } });
      }
      item.selected = !item.selected;
      el.classList.toggle('selected', item.selected);
      emitSelection();
    });

    // 툴 버튼 (✂ 슬라이스 / GIF 프레임)
    const tools = document.createElement('div');
    tools.className = 'item-tools';
    tools.style.cssText = 'position:absolute;top:6px;right:6px;display:flex;gap:6px;';

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
    el.appendChild(tools);

    return item;
  }

  const controller = {
    get folderPath() { return folderPath; },
    get items() { return items; },

    async loadFolder(fp) {
      folderPath = fp;
      stageEl.innerHTML = '';
      items = [];
      folderLabelEl.textContent = fp;
      const res = await window.godiv.listFolderImages(fp);
      if (!res.success) { folderLabelEl.textContent = `로드 실패: ${res.error}`; return; }
      for (const meta of res.images) {
        const durRes = await window.godiv.readImageDataUrl(meta.path);
        if (!durRes.success) continue;
        const item = makeItem(meta, durRes.dataUrl);
        items.push(item);
        stageEl.appendChild(item.el);
      }
      emitSelection();
    },

    // 슬라이스/합치기 결과로 아이템 교체·삽입 (항목10,11 에서 사용)
    async reload() { if (folderPath) await this.loadFolder(folderPath); },

    setZoom(z) { zoom = Math.max(0.2, Math.min(3, z)); applyZoom(); return zoom; },
    getZoom() { return zoom; },
    getSelected() { return items.filter((i) => i.selected); },
    clearSelection() { items.forEach((i) => { i.selected = false; i.el.classList.remove('selected'); }); emitSelection(); },
    emitSelection,
  };

  return controller;
}
