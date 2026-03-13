import caminoFinisterre from './route-geo/camino-finisterre.optimized.json';
import caminoFrancesSarria from './route-geo/camino-frances-sarria.optimized.json';
import caminoIngles from './route-geo/camino-ingles.optimized.json';
import caminoPortuguesLisbon from './route-geo/camino-portugues-lisbon.optimized.json';
import caminoPortuguesPorto from './route-geo/camino-portugues-porto.optimized.json';
import caminoPrimitivo from './route-geo/camino-primitivo.optimized.json';
import routeGeometryStats from './route-geometry-stats.json';

export type RouteGeometryStatsEntry = {
  filename: string;
  routePath: string;
  featureCount: number;
  coordinateCount: number;
  optimizedCoordinateCount: number;
  sourceFileBytes: number;
  optimizedFileBytes: number;
  reducedBytes: number;
  reductionRatio: number;
  tolerance: number;
  decimals: number;
};

type GeometryData = {
  type: string;
  features?: unknown[];
};

type RouteGeometryStatsFile = {
  generatedAt: string;
  routes: RouteGeometryStatsEntry[];
};

type GeometryLoader = () => Promise<GeometryData>;

const statsByPath = new Map(
  (routeGeometryStats as RouteGeometryStatsFile).routes.map((entry) => [entry.routePath, entry]),
);

const eagerGeometryByPath: Record<string, GeometryData> = {
  '/geo/camino-finisterre.geojson': caminoFinisterre as GeometryData,
  '/geo/camino-frances-sarria.geojson': caminoFrancesSarria as GeometryData,
  '/geo/camino-ingles.geojson': caminoIngles as GeometryData,
  '/geo/camino-portugues-lisbon.geojson': caminoPortuguesLisbon as GeometryData,
  '/geo/camino-portugues-porto.geojson': caminoPortuguesPorto as GeometryData,
  '/geo/camino-primitivo.geojson': caminoPrimitivo as GeometryData,
};

const lazyGeometryByPath: Record<string, GeometryLoader> = {
  '/geo/camino-del-norte.geojson': () => import('./route-geo/camino-del-norte.optimized.json').then((mod) => mod.default as GeometryData),
  '/geo/camino-frances-full.geojson': () => import('./route-geo/camino-frances-full.optimized.json').then((mod) => mod.default as GeometryData),
  '/geo/via-de-la-plata.geojson': () => import('./route-geo/via-de-la-plata.optimized.json').then((mod) => mod.default as GeometryData),
};


export const HEAVY_ROUTE_GEOMETRY_PATHS = (routeGeometryStats as RouteGeometryStatsFile).routes
  .filter((entry) => entry.sourceFileBytes >= 300000)
  .map((entry) => entry.routePath);

const geometryPromiseCache = new Map<string, Promise<GeometryData>>();
const summaryLoggedPaths = new Set<string>();
let summaryTableLogged = false;

function fallbackFetch(path: string): Promise<GeometryData> {
  return fetch(path).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<GeometryData>;
  });
}

function loadViaManifest(path: string): Promise<GeometryData> {
  const eager = eagerGeometryByPath[path];
  if (eager) return Promise.resolve(eager);
  const lazy = lazyGeometryByPath[path];
  if (lazy) return lazy();
  return fallbackFetch(path);
}

export function getRouteGeometryDebugSummary(path: string): RouteGeometryStatsEntry | null {
  return statsByPath.get(path) ?? null;
}

export function logRouteGeometrySummary(path: string, enabled: boolean) {
  if (!enabled || summaryLoggedPaths.has(path)) return;
  const summary = getRouteGeometryDebugSummary(path);
  if (!summary) return;
  summaryLoggedPaths.add(path);
  console.log('[RouteDebug][Geometry]', {
    routePath: summary.routePath,
    file: summary.filename,
    originalKb: Number((summary.sourceFileBytes / 1024).toFixed(1)),
    optimizedKb: Number((summary.optimizedFileBytes / 1024).toFixed(1)),
    featureCount: summary.featureCount,
    coordinateCount: summary.coordinateCount,
    optimizedCoordinateCount: summary.optimizedCoordinateCount,
    reductionPct: Number((summary.reductionRatio * 100).toFixed(1)),
  });
}

export function logRouteGeometryTable(enabled: boolean) {
  if (!enabled || summaryTableLogged) return;
  summaryTableLogged = true;
  console.table(
    (routeGeometryStats as RouteGeometryStatsFile).routes.map((entry) => ({
      file: entry.filename,
      path: entry.routePath,
      originalKb: Number((entry.sourceFileBytes / 1024).toFixed(1)),
      optimizedKb: Number((entry.optimizedFileBytes / 1024).toFixed(1)),
      reductionPct: Number((entry.reductionRatio * 100).toFixed(1)),
      coords: entry.coordinateCount,
      optimizedCoords: entry.optimizedCoordinateCount,
    })),
  );
}

export function loadRouteGeometry(path: string): Promise<GeometryData> {
  const cached = geometryPromiseCache.get(path);
  if (cached) return cached;
  const next = loadViaManifest(path).catch((err) => {
    geometryPromiseCache.delete(path);
    throw err;
  });
  geometryPromiseCache.set(path, next);
  return next;
}

export function prefetchRouteGeometry(path: string) {
  void loadRouteGeometry(path).catch(() => {
    geometryPromiseCache.delete(path);
  });
}

export function prefetchRouteGeometries(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  unique.forEach((path) => {
    prefetchRouteGeometry(path);
  });
}

