// platform.js — URL로 플랫폼 자동판별 (네이버 / 쿠팡 / 와디즈)
// 리뷰크롤러 renderer.js detectPlatformFromUrl 패턴 확장.
// 반환: { platform: 'naver'|'coupang'|'wadiz'|'unknown', label, color }

export const PLATFORMS = {
  naver: { label: '네이버', color: '#03c75a' },
  coupang: { label: '쿠팡', color: '#e01e2b' },
  wadiz: { label: '와디즈', color: '#00c4c4' },
  unknown: { label: '알 수 없음', color: '#8a8f98' },
};

export function detectPlatform(url) {
  const u = (url || '').toLowerCase().trim();
  if (!u) return { platform: 'unknown', ...PLATFORMS.unknown };

  // 와디즈: wadiz.kr
  if (u.includes('wadiz.kr')) return { platform: 'wadiz', ...PLATFORMS.wadiz };

  // 쿠팡: coupang.com / coupang.co.kr
  if (u.includes('coupang.com') || u.includes('coupang.co.kr'))
    return { platform: 'coupang', ...PLATFORMS.coupang };

  // 네이버: smartstore / shopping / brand.naver / naver.me 등
  if (
    u.includes('smartstore.naver.com') ||
    u.includes('shopping.naver.com') ||
    u.includes('brand.naver.com') ||
    u.includes('naver.me') ||
    (u.includes('naver.com') && (u.includes('/products/') || u.includes('/items/')))
  )
    return { platform: 'naver', ...PLATFORMS.naver };

  return { platform: 'unknown', ...PLATFORMS.unknown };
}
