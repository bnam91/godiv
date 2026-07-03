// slice.js — 가로 절단선 슬라이스 (항목10). [SCAFFOLD STUB] 에이전트가 채운다.
// 참고: /Users/a1/web-editor/js/scratch-pad.js  _enterSliceMode()(272), _sliceImageHorizontal()(195)
// 동작: item 위에 가로 절단선 → mousemove로 y 실시간 미리보기(ratio 0.02~0.98) → 클릭 확정,
//       Esc/바깥클릭 취소. 확정 시 canvas drawImage로 위/아래 두 PNG 생성 →
//       window.godiv.saveImage 로 folderPath 에 새 파일(예: 01_a.png/01_b.png) 저장 → controller.reload().
export function enableSlice(item, controller) {
  window.__godivToast?.('[미구현] 슬라이스는 항목10 에이전트 대기');
  console.log('[slice STUB]', item?.name);
}
