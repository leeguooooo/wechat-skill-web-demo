// Tiny formatting helpers shared by Svelte components.

export function formatHm(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Returns a WeChat-style relative date label for a time divider.
 * - same day → "HH:mm"
 * - yesterday → "昨天 HH:mm"
 * - within 7 days → "周一 HH:mm" / "周二 HH:mm" ...
 * - else → "YYYY/M/D HH:mm"
 */
export function formatRelativeDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  const hm = formatHm(ts);
  if (sameDay) return hm;
  if (isYesterday) return `昨天 ${hm}`;
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays >= 0 && diffDays < 7) {
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${week[d.getDay()]} ${hm}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

// Stable color block for placeholder avatar based on name hash.
export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const palette = [
    '#1AAD19',
    '#576b95',
    '#c98300',
    '#9c5fb5',
    '#3d6b8e',
    '#7a7a7a',
    '#b85c2f',
    '#2b8174',
  ];
  return palette[Math.abs(hash) % palette.length];
}

export function initials(name: string): string {
  const trimmed = (name || '?').trim();
  if (!trimmed) return '?';
  // For CJK names, use last char (most personal); for latin, use first letter.
  const firstChar = trimmed[0];
  if (/[一-鿿]/.test(firstChar)) return trimmed.slice(-1);
  return firstChar.toUpperCase();
}
