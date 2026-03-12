import type { RouteGroup, RouteVariant } from '../types/routes';
import { stripParenEnglish } from './formatName';
import { getPopularityLevel } from './popularity';

export function getDifficultyLevel(group: RouteGroup | null | undefined): number {
  return Math.min(5, Math.max(1, group?.difficulty_shells || 1));
}

export function getHotLabel(groupId: string, variantId: string): string {
  return '🔥'.repeat(getPopularityLevel(groupId, variantId));
}

export function getRouteDisplayNames(group: RouteGroup, variant: RouteVariant): {
  groupZh: string;
  groupEn: string;
  variantZh: string;
  variantEn: string;
} {
  const isAfterSantiagoMain =
    group.id === 'camino-finisterre-after-santiago' && variant.id === 'camino-finisterre-main';
  const groupZh = isAfterSantiagoMain
    ? '朝圣之后：抵达世界尽头'
    : stripParenEnglish(group.name_zh || '') || group.name_zh;

  return {
    groupZh,
    groupEn: isAfterSantiagoMain ? 'After Santiago: Reaching the End of the World' : group.name_en,
    variantZh: variant.variant_name_zh,
    variantEn: isAfterSantiagoMain ? 'Main Route (Fisterra)' : variant.variant_name_en,
  };
}

export function getRouteSummary(group: RouteGroup, variant: RouteVariant): string {
  return (
    variant.route_impression ||
    variant.note ||
    variant.positioning ||
    group.tagline ||
    '适合加入备选清单进一步比较。'
  );
}

export function getDaysLabel(min: number, max: number): string {
  if (!min && !max) return '天数待补充';
  if (min === max) return `${min} 天`;
  return `${min}-${max} 天`;
}
