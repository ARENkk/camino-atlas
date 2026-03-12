export function formatName(zh?: string, en?: string): string {
  const zhText = (zh ?? '').trim();
  const enText = (en ?? '').trim();
  if (!zhText) return enText;
  if (!enText) return zhText;
  if (zhText.toLowerCase().includes(enText.toLowerCase())) return zhText;
  return `${zhText} (${enText})`;
}

export function splitName(zh?: string, en?: string): { zh: string; en: string } {
  const zhText = (zh ?? '').trim();
  const enText = (en ?? '').trim();
  if (!zhText && !enText) return { zh: '', en: '' };
  if (!zhText) return { zh: enText, en: '' };
  if (!enText) return { zh: zhText, en: '' };
  if (zhText.toLowerCase().includes(enText.toLowerCase())) return { zh: zhText, en: '' };
  return { zh: zhText, en: enText };
}

export function stripParenEnglish(name?: string): string {
  const text = (name ?? '').trim();
  if (!text) return '';
  return text
    .replace(/（[^）]*[A-Za-z][^）]*）/g, '')
    .replace(/\([^)]*[A-Za-z][^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldShowEnLine(zh?: string, en?: string): boolean {
  const zhClean = stripParenEnglish(zh).trim();
  const enClean = (en ?? '').trim();
  if (!enClean) return false;
  if (zhClean === enClean) return false;
  if (zhClean.toLowerCase().includes(enClean.toLowerCase())) return false;
  return true;
}

export function formatVariantTitleZh(variantZh?: string, startPlaceZh?: string): string {
  const base = stripParenEnglish(variantZh);
  if (!base) return stripParenEnglish(startPlaceZh);
  if (/（[^）]+）/.test(base)) return base;
  const startZh = stripParenEnglish(startPlaceZh);
  if (!startZh) return base;
  return `${base}（${startZh}）`;
}

export function formatPlaceZhEn(zh?: string, en?: string): string {
  const zhText = (zh ?? '').trim();
  const enText = (en ?? '').trim();
  if (!zhText) return enText;
  if (!enText) return zhText;
  if (zhText.toLowerCase().includes(enText.toLowerCase())) return zhText;
  return `${zhText}（${enText}）`;
}

export function formatRouteLineZhEn(
  startZh?: string,
  startEn?: string,
  endZh?: string,
  endEn?: string,
): string {
  return `${formatPlaceZhEn(startZh, startEn)} -> ${formatPlaceZhEn(endZh, endEn)}`;
}
