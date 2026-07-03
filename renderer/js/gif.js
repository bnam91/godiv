// gif.js — GIF 프레임 뷰어 + 선택 프레임 PNG 내보내기 (항목12). [SCAFFOLD STUB] 에이전트가 채운다.
// gifuct-js로 GIF 디코딩 → #gif-modal 에서 슬라이더로 프레임 탐색 →
//   ① "이 프레임 PNG 저장" → window.godiv.saveImage (예: 03_frame05.png)
//   ② 선택 프레임을 item.gifFrameDataUrl 에 저장 → merge 시 정지 이미지로 사용
export function isGifItem(item) {
  return !!item?.isGif || (item?.ext || '').toLowerCase() === '.gif';
}

export function openGifViewer(item, controller) {
  window.__godivToast?.('[미구현] GIF 프레임 뷰어는 항목12 에이전트 대기');
  console.log('[gif STUB]', item?.name);
}
