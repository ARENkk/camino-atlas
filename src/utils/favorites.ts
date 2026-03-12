import type { RouteGroup, RouteVariant } from '../types/routes';
import { getDaysLabel, getDifficultyLevel, getHotLabel, getRouteDisplayNames, getRouteSummary } from './routeDisplay';

export const FAVORITES_STORAGE_KEY = 'camino_atlas.favorites';

type UnknownFavoriteRecord = {
  variantId?: unknown;
  variant_id?: unknown;
  variant?: unknown;
  routeId?: unknown;
  route_id?: unknown;
  id?: unknown;
  slug?: unknown;
};

export type DrawerFavoriteItem = {
  variantId: string;
  groupId: string;
  groupZh: string;
  groupEn: string;
  variantZh: string;
  variantEn: string;
  distanceKm: number;
  daysLabel: string;
  difficultyLabel: string;
  hotLabel: string;
  summary: string;
};

function toVariantId(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const value = raw.trim();
    return value || null;
  }
  if (typeof raw !== 'object') return null;
  const item = raw as UnknownFavoriteRecord;
  const candidate =
    item.variantId ??
    item.variant_id ??
    item.variant ??
    item.routeId ??
    item.route_id ??
    item.id ??
    item.slug;
  if (typeof candidate !== 'string') return null;
  const value = candidate.trim();
  return value || null;
}

export function normalizeFavoriteVariantIds(raw: unknown, validVariantIds?: Set<string>): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as { favorites?: unknown; items?: unknown; list?: unknown }).favorites ??
          (raw as { favorites?: unknown; items?: unknown; list?: unknown }).items ??
          (raw as { favorites?: unknown; items?: unknown; list?: unknown }).list ??
          [])
      : [];

  if (!Array.isArray(list)) return [];

  const unique = new Set<string>();
  for (const entry of list) {
    const variantId = toVariantId(entry);
    if (!variantId) continue;
    if (validVariantIds && !validVariantIds.has(variantId)) continue;
    unique.add(variantId);
  }
  return Array.from(unique);
}

export function readFavoriteIdsFromStorage(validVariantIds: Set<string>): string[] {
  if (typeof window === 'undefined') return [];
  const rawText = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
  if (!rawText) return [];
  try {
    const parsed = JSON.parse(rawText);
    return normalizeFavoriteVariantIds(parsed, validVariantIds);
  } catch {
    return [];
  }
}

export function resolveFavoritesForDrawer(
  favoriteIds: string[],
  variantsById: Record<string, RouteVariant>,
  groupsById: Record<string, RouteGroup>,
): DrawerFavoriteItem[] {
  return favoriteIds
    .map((variantId) => {
      const variant = variantsById[variantId];
      if (!variant) return null;
      const group = groupsById[variant.group_id];
      if (!group) return null;
      const display = getRouteDisplayNames(group, variant);
      return {
        variantId: variant.id,
        groupId: group.id,
        groupZh: display.groupZh,
        groupEn: display.groupEn,
        variantZh: display.variantZh,
        variantEn: display.variantEn,
        distanceKm: variant.distance_km_total,
        daysLabel: getDaysLabel(variant.days_recommended_total.min, variant.days_recommended_total.max),
        difficultyLabel: `难度 ${getDifficultyLevel(group)}/5`,
        hotLabel: `热门 ${getHotLabel(group.id, variant.id)}`,
        summary: getRouteSummary(group, variant),
      };
    })
    .filter((item): item is DrawerFavoriteItem => Boolean(item));
}
