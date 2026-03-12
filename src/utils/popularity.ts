const GROUP_POPULARITY: Record<string, number> = {
  'camino-frances': 5,
  'camino-portugues': 4,
  'camino-ingles': 3,
  'camino-primitivo': 3,
  'camino-del-norte': 2,
  'via-de-la-plata': 1,
  'camino-finisterre-after-santiago': 2,
};

const VARIANT_POPULARITY: Record<string, number> = {
  camino_frances_full: 5,
  'camino-frances-sarria-last100': 5,
  'camino-portugues-full-lisbon': 3,
  'camino-portugues-popular-porto': 4,
  'camino-ingles-main': 3,
  'camino-primitivo-main': 3,
  'camino-del-norte-main': 2,
  'via-de-la-plata-main': 1,
  'camino-finisterre-main': 2,
};

export function getPopularityLevel(groupId: string, variantId?: string): number {
  const level = (variantId && VARIANT_POPULARITY[variantId]) || GROUP_POPULARITY[groupId] || 1;
  return Math.min(5, Math.max(1, level));
}
