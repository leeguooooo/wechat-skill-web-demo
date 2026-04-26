// Tiny formatting helpers shared by Svelte components.

export function formatHm(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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
