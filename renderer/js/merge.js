// merge.js — 다중선택 세로 합치기 (항목11). [SCAFFOLD STUB] 에이전트가 채운다.
// 동작: 선택 아이템들을 위→아래 순서로 세로 concat. 폭은 최대폭 기준 스케일 정규화.
//       GIF가 섞이면 해당 GIF의 선택 프레임(gifFrameDataUrl)을 정지 이미지로 사용(없으면 첫 프레임).
//       결과는 canvas → PNG dataURL → window.godiv.saveImage 로 merged_NN.png 저장 → controller.reload().
export async function mergeItems(items, controller) {
  window.__godivToast?.('[미구현] 합치기는 항목11 에이전트 대기');
  console.log('[merge STUB]', items?.map((i) => i.name));
}
