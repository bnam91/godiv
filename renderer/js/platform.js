// platform.js (renderer) — 즉시 뱃지용 로컬 판별. main의 electron/services/platform.js와 동일 규칙.
export const PLATFORMS = {
  naver: { label: '네이버', color: '#03c75a' },
  coupang: { label: '쿠팡', color: '#e01e2b' },
  wadiz: { label: '와디즈', color: '#00c4c4' },
  unknown: { label: '—', color: '#8a8f98' },
};

export function detectPlatform(url) {
  const u = (url || '').toLowerCase().trim();
  if (!u) return { platform: 'unknown', ...PLATFORMS.unknown };
  if (u.includes('wadiz.kr')) return { platform: 'wadiz', ...PLATFORMS.wadiz };
  if (u.includes('coupang.com') || u.includes('coupang.co.kr')) return { platform: 'coupang', ...PLATFORMS.coupang };
  if (
    u.includes('smartstore.naver.com') || u.includes('shopping.naver.com') ||
    u.includes('brand.naver.com') || u.includes('naver.me') ||
    (u.includes('naver.com') && (u.includes('/products/') || u.includes('/items/')))
  ) return { platform: 'naver', ...PLATFORMS.naver };
  return { platform: 'unknown', ...PLATFORMS.unknown };
}
