import { useEffect, useRef, useState } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getRouteGeometryDebugSummary, loadRouteGeometry, logRouteGeometrySummary, logRouteGeometryTable } from '../data/routeGeometry';
import type { RouteVariant } from '../types/routes';

type LngLat = [number, number];
type Feature = {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: unknown;
  };
};
type FeatureCollection = {
  type: 'FeatureCollection';
  features: Feature[];
};

type Props = {
  variant: RouteVariant | null;
  selectedVariantId: string;
  renderedVariantId: string;
  onRenderedVariantChange?: (variantId: string) => void;
};

type MobileTerminalInfo = {
  id: string | number;
  label: string;
  zh: string;
  en: string;
  note: string;
};

type PreparedRouteData = {
  routeData: any;
  terminalData: any;
  renderedBounds: LngLatBounds;
  renderedStart: LngLat;
  renderedEnd: LngLat;
};

type QueuedRouteSwitch = {
  variant: RouteVariant;
  reason: 'requested' | 'queued';
};

type ActiveRouteRequest = {
  token: number;
  variantId: string;
  geometryPath: string;
  controller: AbortController;
};

const SOURCE_ID = 'route-source';
const LINE_LAYER_ID = 'route-line';
const TERMINAL_SOURCE_ID = 'route-terminals';
const TERMINAL_GLOW_LAYER_ID = 'route-terminal-glow';
const TERMINAL_INNER_LAYER_ID = 'route-terminal-inner';
const TERMINAL_CORE_LAYER_ID = 'route-terminal-core';
const SHOW_DEBUG_TERMINALS = false;
const ENABLE_TERMINALS = true;
const TERMINAL_HOVER_SCALE = 1.05;
const TERMINAL_HOVER_DURATION = 140;
const TERMINAL_POPUP_HIDE_DELAY = 100;
const DESKTOP_HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const NON_HOVER_QUERY = '(hover: none), (pointer: coarse)';
const DESKTOP_FIT_BOUNDS_DURATION = 820;
const MOBILE_FIT_BOUNDS_DURATION = 0;
const ROUTE_SLOW_HINT_MS = 600;
const ROUTE_RETRY_HINT_MS = 8000;
const ROUTE_SETTLE_TIMEOUT_MS = 2200;
const ENABLE_ROUTE_DEBUG = false;

function routeDebug(...args: unknown[]) {
  if (!ENABLE_ROUTE_DEBUG) return;
  console.log('[RouteDebug][MapView]', ...args);
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw createAbortError();
}

function waitForAnimationFrames(frameCount: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let remaining = Math.max(frameCount, 0);
    let rafId: number | null = null;

    const cleanup = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const tick = () => {
      if (signal.aborted) {
        onAbort();
        return;
      }
      if (remaining <= 0) {
        cleanup();
        resolve();
        return;
      }
      remaining -= 1;
      rafId = window.requestAnimationFrame(tick);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    tick();
  });
}

function waitForMapStyleLoad(map: maplibregl.Map, signal: AbortSignal): Promise<void> {
  if (map.isStyleLoaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      map.off('load', onLoad);
      signal.removeEventListener('abort', onAbort);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    map.on('load', onLoad);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortLikeError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  const name = typeof (err as { name?: unknown })?.name === 'string' ? (err as { name: string }).name : '';
  if (name === 'AbortError') return true;
  const message =
    typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : '';
  return /abort(?:ed)?|signal is aborted/i.test(message);
}

function ensureFeatureCollection(input: any): FeatureCollection {
  if (input?.type === 'FeatureCollection' && Array.isArray(input.features)) {
    return input as FeatureCollection;
  }
  if (input?.type === 'Feature') {
    return { type: 'FeatureCollection', features: [input as Feature] };
  }
  if (input?.type && input?.coordinates) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: input.type, coordinates: input.coordinates } }],
    };
  }
  return { type: 'FeatureCollection', features: [] };
}

function collectSegments(collection: FeatureCollection): LngLat[][] {
  const out: LngLat[][] = [];
  collection.features.forEach((feature) => {
    const g = feature.geometry;
    if (!g) return;
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      const line = (g.coordinates as unknown[]).map((p) => toLngLat(p)).filter((p): p is LngLat => Boolean(p));
      if (line.length > 1) out.push(line);
    } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      (g.coordinates as unknown[]).forEach((rawLine) => {
        if (!Array.isArray(rawLine)) return;
        const line = rawLine.map((p) => toLngLat(p)).filter((p): p is LngLat => Boolean(p));
        if (line.length > 1) out.push(line);
      });
    }
  });
  return out;
}

function toLngLat(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function collectFlattenedCoords(segments: LngLat[][]): LngLat[] {
  const coords: LngLat[] = [];
  segments.forEach((seg) => {
    seg.forEach((p) => {
      const c = toLngLat(p);
      if (!c) return;
      const last = coords[coords.length - 1];
      if (!last || pointKey(last) !== pointKey(c)) coords.push(c);
    });
  });
  return coords;
}

function lineLength(line: LngLat[]): number {
  let sum = 0;
  for (let i = 1; i < line.length; i += 1) {
    const dx = line[i][0] - line[i - 1][0];
    const dy = line[i][1] - line[i - 1][1];
    sum += Math.sqrt(dx * dx + dy * dy);
  }
  return sum;
}

function pointKey(p: LngLat): string {
  return `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pointDistance(a: LngLat, b: LngLat): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function findNearestNode(target: LngLat, nodeKeys: string[], nodeCoords: Map<string, LngLat>): string | null {
  if (!nodeKeys.length) return null;
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  nodeKeys.forEach((k) => {
    const c = nodeCoords.get(k);
    if (!c) return;
    const d = pointDistance(target, c);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  });
  return best;
}

function dijkstraAllNodes(
  graph: Map<string, Array<{ to: string; weight: number }>>,
  from: string,
): { dist: Map<string, number>; prev: Map<string, string | null> } {
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();
  graph.forEach((_, k) => {
    dist.set(k, Number.POSITIVE_INFINITY);
    prev.set(k, null);
  });
  if (!dist.has(from)) return { dist, prev };
  dist.set(from, 0);

  while (visited.size < graph.size) {
    let cur: string | null = null;
    let curD = Number.POSITIVE_INFINITY;
    graph.forEach((_, k) => {
      if (visited.has(k)) return;
      const d = dist.get(k)!;
      if (d < curD) {
        cur = k;
        curD = d;
      }
    });
    if (!cur || !Number.isFinite(curD)) break;
    visited.add(cur);
    (graph.get(cur) || []).forEach(({ to, weight }) => {
      if (visited.has(to)) return;
      const next = curD + weight;
      if (next < (dist.get(to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(to, next);
        prev.set(to, cur);
      }
    });
  }
  return { dist, prev };
}

function readDeclaredCoord(variant: RouteVariant | null, kind: 'start' | 'end'): LngLat | null {
  if (!variant) return null;
  const raw = variant as RouteVariant & {
    start_coord?: unknown;
    end_coord?: unknown;
    start_coords?: unknown;
    end_coords?: unknown;
    start_lnglat?: unknown;
    end_lnglat?: unknown;
  };
  const candidates =
    kind === 'start'
      ? [raw.start_coord, raw.start_coords, raw.start_lnglat]
      : [raw.end_coord, raw.end_coords, raw.end_lnglat];
  for (const value of candidates) {
    const coord = toLngLat(value);
    if (coord) return coord;
  }
  return null;
}

function buildOrderedMainRoute(
  collection: FeatureCollection,
  declaredStartCoord?: LngLat | null,
  declaredEndCoord?: LngLat | null,
): {
  orderedCoords: LngLat[];
  startCoord: LngLat;
  endCoord: LngLat;
  bounds: LngLatBounds;
} {
  const segments = collectSegments(collection);
  if (!segments.length) throw new Error('no line segments');
  if (segments.length === 1) {
    const ordered = segments[0];
    const bounds = ordered.reduce((acc, p) => acc.extend(p), new LngLatBounds(ordered[0], ordered[0]));
    return {
      orderedCoords: ordered,
      startCoord: ordered[0],
      endCoord: ordered[ordered.length - 1],
      bounds,
    };
  }

  const nodeCoords = new Map<string, LngLat>();
  const degree = new Map<string, number>();
  const graph = new Map<string, Array<{ to: string; weight: number; edgeKey: string }>>();
  const edgePath = new Map<string, LngLat[]>();

  const addNode = (p: LngLat): string => {
    const k = pointKey(p);
    if (!nodeCoords.has(k)) nodeCoords.set(k, p);
    if (!degree.has(k)) degree.set(k, 0);
    if (!graph.has(k)) graph.set(k, []);
    return k;
  };

  segments.forEach((segRaw) => {
    const seg = segRaw.map((p) => toLngLat(p)).filter((p): p is LngLat => !!p);
    if (seg.length < 2) return;
    const a = seg[0];
    const b = seg[seg.length - 1];
    const ak = addNode(a);
    const bk = addNode(b);
    const ek = pairKey(ak, bk);
    const w = Math.max(lineLength(seg), 1e-9);
    const existing = edgePath.get(ek);
    if (!existing || lineLength(existing) < w) edgePath.set(ek, seg);
    graph.get(ak)!.push({ to: bk, weight: w, edgeKey: ek });
    graph.get(bk)!.push({ to: ak, weight: w, edgeKey: ek });
    degree.set(ak, (degree.get(ak) || 0) + 1);
    degree.set(bk, (degree.get(bk) || 0) + 1);
  });

  let endpoints = Array.from(degree.entries())
    .filter(([, d]) => d === 1)
    .map(([k]) => k);
  if (endpoints.length < 2) endpoints = Array.from(nodeCoords.keys());
  if (endpoints.length < 2) {
    const ordered = collectFlattenedCoords(segments);
    const bounds = ordered.reduce((acc, p) => acc.extend(p), new LngLatBounds(ordered[0], ordered[0]));
    return {
      orderedCoords: ordered,
      startCoord: ordered[0],
      endCoord: ordered[ordered.length - 1],
      bounds,
    };
  }

  let bestStart = endpoints[0];
  let bestEnd = endpoints[1];

  const normalizedStart =
    declaredStartCoord && findNearestNode(declaredStartCoord, endpoints, nodeCoords);
  const normalizedEnd = declaredEndCoord && findNearestNode(declaredEndCoord, endpoints, nodeCoords);
  if (normalizedStart && normalizedEnd && normalizedStart !== normalizedEnd) {
    bestStart = normalizedStart;
    bestEnd = normalizedEnd;
  } else if (normalizedStart && endpoints.length > 1) {
    bestStart = normalizedStart;
    const startCoord = nodeCoords.get(bestStart)!;
    let far = endpoints.find((k) => k !== bestStart) ?? endpoints[0];
    let farDist = -1;
    endpoints.forEach((k) => {
      if (k === bestStart) return;
      const d = pointDistance(startCoord, nodeCoords.get(k)!);
      if (d > farDist) {
        far = k;
        farDist = d;
      }
    });
    bestEnd = far;
  } else {
    let bestDist = -1;
    endpoints.forEach((s) => {
      endpoints.forEach((t) => {
        if (s === t) return;
        const d = pointDistance(nodeCoords.get(s)!, nodeCoords.get(t)!);
        if (d > bestDist) {
          bestDist = d;
          bestStart = s;
          bestEnd = t;
        }
      });
    });
  }

  const { prev } = dijkstraAllNodes(
    new Map(
      Array.from(graph.entries()).map(([k, edges]) => [k, edges.map(({ to, weight }) => ({ to, weight }))]),
    ),
    bestStart,
  );
  const nodePath: string[] = [];
  let cur: string | null = bestEnd;
  while (cur) {
    nodePath.push(cur);
    if (cur === bestStart) break;
    cur = prev.get(cur) ?? null;
  }
  nodePath.reverse();
  if (nodePath.length < 2) {
    const flattened = collectFlattenedCoords(segments);
    const fallback = flattened.length > 1 ? flattened : segments[0];
    const bounds = fallback.reduce((acc, p) => acc.extend(p), new LngLatBounds(fallback[0], fallback[0]));
    return {
      orderedCoords: fallback,
      startCoord: fallback[0],
      endCoord: fallback[fallback.length - 1],
      bounds,
    };
  }

  const ordered: LngLat[] = [];
  for (let i = 0; i < nodePath.length - 1; i += 1) {
    const a = nodePath[i];
    const b = nodePath[i + 1];
    const seg = edgePath.get(pairKey(a, b));
    if (!seg || !seg.length) continue;
    const aCoord = nodeCoords.get(a)!;
    const oriented = pointKey(seg[0]) === pointKey(aCoord) ? seg : [...seg].reverse();
    if (!ordered.length) ordered.push(...oriented);
    else ordered.push(...oriented.slice(1));
  }

  const deduped: LngLat[] = [];
  ordered.forEach((p) => {
    const last = deduped[deduped.length - 1];
    if (!last || pointKey(last) !== pointKey(p)) deduped.push(p);
  });

  const safeOrdered = deduped.length > 1 ? deduped : collectFlattenedCoords(segments);
  const bounds = safeOrdered.reduce((acc, p) => acc.extend(p), new LngLatBounds(safeOrdered[0], safeOrdered[0]));
  return {
    orderedCoords: safeOrdered,
    startCoord: safeOrdered[0],
    endCoord: safeOrdered[safeOrdered.length - 1],
    bounds,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function prepareRouteData(variant: RouteVariant, rawGeojson: unknown): PreparedRouteData {
  const input = ensureFeatureCollection(rawGeojson);
  const declaredStartCoord = readDeclaredCoord(variant, 'start');
  const declaredEndCoord = readDeclaredCoord(variant, 'end');
  const mainRoute = buildOrderedMainRoute(input, declaredStartCoord, declaredEndCoord);
  const routeData = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: mainRoute.orderedCoords,
        },
      },
    ],
  } as any;
  const renderedFeature = routeData.features[0];
  const renderedLineCoords = (renderedFeature?.geometry?.coordinates || []) as LngLat[];
  if (renderedLineCoords.length < 2) throw new Error('invalid rendered line coords');
  const renderedStart = renderedLineCoords[0];
  const renderedEnd = renderedLineCoords[renderedLineCoords.length - 1];
  const renderedBounds = renderedLineCoords.reduce(
    (acc, p) => acc.extend(p),
    new LngLatBounds(renderedStart, renderedStart),
  );

  return {
    routeData,
    terminalData: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'start',
          properties: {
            kind: 'start',
            label: '起点',
            zh: variant.start_place?.zh || '起点',
            en: variant.start_place?.en || '',
          },
          geometry: { type: 'Point', coordinates: renderedStart },
        },
        {
          type: 'Feature',
          id: 'end',
          properties: {
            kind: 'end',
            label: '终点',
            zh: variant.end_place?.zh || '终点',
            en: variant.end_place?.en || '',
          },
          geometry: { type: 'Point', coordinates: renderedEnd },
        },
      ],
    } as any,
    renderedBounds,
    renderedStart,
    renderedEnd,
  };
}

export function MapView({
  variant,
  selectedVariantId,
  renderedVariantId,
  onRenderedVariantChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const terminalTapMarkersRef = useRef<maplibregl.Marker[]>([]);
  const desktopHoverCapableRef = useRef(true);
  const hoveredTerminalIdRef = useRef<string | number | null>(null);
  const selectedTerminalIdRef = useRef<string | number | null>(null);
  const suppressNextMapClickRef = useRef(false);
  const suppressNextMapClickTimerRef = useRef<number | null>(null);
  const lastMobileTapRef = useRef<{ id: string | number; time: number } | null>(null);
  const hidePopupTimerRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);
  const routeCacheRef = useRef<Map<string, PreparedRouteData>>(new Map());
  const activeRequestRef = useRef<ActiveRouteRequest | null>(null);
  const requestedSwitchRef = useRef<QueuedRouteSwitch | null>(null);
  const queuedSwitchRef = useRef<QueuedRouteSwitch | null>(null);
  const switchInFlightRef = useRef(false);
  const processLoopPromiseRef = useRef<Promise<void> | null>(null);
  const settleWatcherCleanupRef = useRef<(() => void) | null>(null);
  const badgeTimersRef = useRef<number[]>([]);
  const lastAppliedPathRef = useRef<string | null>(null);
  const onRenderedVariantChangeRef = useRef<Props['onRenderedVariantChange']>(onRenderedVariantChange);
  const onTerminalEnterRef = useRef<((e: any) => void) | null>(null);
  const onTerminalLeaveRef = useRef<((e: any) => void) | null>(null);
  const onTerminalClickRef = useRef<((e: any) => void) | null>(null);
  const onMapClickRef = useRef<((e: any) => void) | null>(null);
  const onMapDragStartRef = useRef<(() => void) | null>(null);
  const [isDesktopHoverCapable, setIsDesktopHoverCapable] = useState(true);
  const [mobileActiveTerminal, setMobileActiveTerminal] = useState<MobileTerminalInfo | null>(null);
  const [prefersReducedRouteMotion, setPrefersReducedRouteMotion] = useState(false);
  const [isRouteRequestPending, setIsRouteRequestPending] = useState(false);
  const [hasAppliedSelectedRoute, setHasAppliedSelectedRoute] = useState(false);
  const [showLoadingBadge, setShowLoadingBadge] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const [showRetryHint, setShowRetryHint] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onRenderedVariantChangeRef.current = onRenderedVariantChange;
  }, [onRenderedVariantChange]);

  useEffect(() => {
    routeDebug('variant state', { selectedVariantId, renderedVariantId });
  }, [renderedVariantId, selectedVariantId]);

  const clearTerminalState = (map?: maplibregl.Map | null) => {
    const currentMap = map ?? mapRef.current;
    if (!currentMap) return;
    if (hoveredTerminalIdRef.current !== null) {
      currentMap.setFeatureState({ source: TERMINAL_SOURCE_ID, id: hoveredTerminalIdRef.current }, { hover: false });
      hoveredTerminalIdRef.current = null;
    }
    if (selectedTerminalIdRef.current !== null) {
      currentMap.setFeatureState({ source: TERMINAL_SOURCE_ID, id: selectedTerminalIdRef.current }, { hover: false });
      selectedTerminalIdRef.current = null;
    }
    currentMap.getCanvas().style.cursor = '';
  };

  const clearTerminalPopup = () => {
    if (hidePopupTimerRef.current !== null) {
      window.clearTimeout(hidePopupTimerRef.current);
      hidePopupTimerRef.current = null;
    }
    popupRef.current?.remove();
    popupRef.current = null;
  };

  const clearMapClickSuppression = () => {
    suppressNextMapClickRef.current = false;
    if (suppressNextMapClickTimerRef.current !== null) {
      window.clearTimeout(suppressNextMapClickTimerRef.current);
      suppressNextMapClickTimerRef.current = null;
    }
  };

  const suppressUpcomingMapClick = () => {
    clearMapClickSuppression();
    suppressNextMapClickRef.current = true;
    suppressNextMapClickTimerRef.current = window.setTimeout(() => {
      suppressNextMapClickRef.current = false;
      suppressNextMapClickTimerRef.current = null;
    }, 400);
  };

  const clearBadgeTimers = () => {
    badgeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    badgeTimersRef.current = [];
  };

  const clearSettleWatcher = () => {
    settleWatcherCleanupRef.current?.();
    settleWatcherCleanupRef.current = null;
  };

  const isCurrentRequest = (token: number) => {
    return requestSeqRef.current === token && activeRequestRef.current?.token === token;
  };

  const beginRequestProgress = (token: number) => {
    clearBadgeTimers();
    setHasAppliedSelectedRoute(false);
    setShowLoadingBadge(true);
    setShowSlowHint(false);
    setShowRetryHint(false);

    badgeTimersRef.current = [
      window.setTimeout(() => {
        if (!isCurrentRequest(token)) return;
        setShowSlowHint(true);
      }, ROUTE_SLOW_HINT_MS),
      window.setTimeout(() => {
        if (!isCurrentRequest(token)) return;
        setShowRetryHint(true);
      }, ROUTE_RETRY_HINT_MS),
    ];
  };

  const finalizeRequestProgress = (token: number) => {
    if (!isCurrentRequest(token)) return;
    clearBadgeTimers();
    setIsRouteRequestPending(false);
    setHasAppliedSelectedRoute(true);
    setShowLoadingBadge(false);
    setShowSlowHint(false);
    setShowRetryHint(false);
  };

  const abortActiveRequest = (reason: string) => {
    const active = activeRequestRef.current;
    if (!active) return;
    routeDebug('fetch abort', {
      token: active.token,
      variantId: active.variantId,
      reason,
    });
    active.controller.abort();
    activeRequestRef.current = null;
    clearSettleWatcher();
    switchInFlightRef.current = false;
  };

  const waitForRouteRenderSettlement = (map: maplibregl.Map, token: number) =>
    new Promise<void>((resolve) => {
      let completed = false;
      let rafA: number | null = null;
      let rafB: number | null = null;
      let timeoutId: number | null = null;

      const cleanup = () => {
        map.off('idle', onIdle);
        map.off('render', onRender);
        if (rafA !== null) window.cancelAnimationFrame(rafA);
        if (rafB !== null) window.cancelAnimationFrame(rafB);
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      };

      const finish = (reason: string) => {
        if (completed) return;
        completed = true;
        cleanup();
        if (settleWatcherCleanupRef.current === cleanup) {
          settleWatcherCleanupRef.current = null;
        }
        routeDebug('render settled', { token, reason });
        resolve();
      };

      const onIdle = () => finish('idle');
      const onRender = () => {
        if (rafA !== null) window.cancelAnimationFrame(rafA);
        if (rafB !== null) window.cancelAnimationFrame(rafB);
        rafA = window.requestAnimationFrame(() => {
          rafB = window.requestAnimationFrame(() => {
            if (!map.isMoving()) finish('render-frame');
          });
        });
      };

      settleWatcherCleanupRef.current = cleanup;
      map.on('idle', onIdle);
      map.on('render', onRender);
      timeoutId = window.setTimeout(() => finish('settle-timeout'), ROUTE_SETTLE_TIMEOUT_MS);
      onRender();
    });

  const renderTerminalPopup = (map: maplibregl.Map, feature: any) => {
    const coords = (feature?.geometry?.coordinates || []) as LngLat;
    if (!Array.isArray(coords) || coords.length < 2) return;
    const props = feature?.properties || {};
    const label = props.label || (props.kind === 'start' ? '起点' : '终点');
    const zh = props.zh || label;
    const en = props.en || '';
    clearTerminalPopup();

    const container = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.className = 'popup-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const titleEl = document.createElement('div');
    titleEl.className = 'popup-title';
    titleEl.textContent = zh;
    container.appendChild(titleEl);

    if (en) {
      const subEl = document.createElement('div');
      subEl.className = 'popup-sub';
      subEl.textContent = en;
      container.appendChild(subEl);
    }

    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 18,
      maxWidth: desktopHoverCapableRef.current ? '240px' : '220px',
      className: 'route-marker-popup',
    })
      .setLngLat(coords)
      .setDOMContent(container)
      .addTo(map);
  };

  const removeTerminalTapMarkers = () => {
    terminalTapMarkersRef.current.forEach((marker) => marker.remove());
    terminalTapMarkersRef.current = [];
  };

  const setSelectedTerminal = (map: maplibregl.Map, feature: any) => {
    const id = feature?.id as string | number | undefined;
    if (id === undefined) return;
    if (hidePopupTimerRef.current !== null) {
      window.clearTimeout(hidePopupTimerRef.current);
      hidePopupTimerRef.current = null;
    }
    if (hoveredTerminalIdRef.current !== null) {
      map.setFeatureState({ source: TERMINAL_SOURCE_ID, id: hoveredTerminalIdRef.current }, { hover: false });
      hoveredTerminalIdRef.current = null;
    }
    if (selectedTerminalIdRef.current !== null && selectedTerminalIdRef.current !== id) {
      map.setFeatureState({ source: TERMINAL_SOURCE_ID, id: selectedTerminalIdRef.current }, { hover: false });
    }
    selectedTerminalIdRef.current = id;
    map.setFeatureState({ source: TERMINAL_SOURCE_ID, id }, { hover: true });
    if (desktopHoverCapableRef.current) {
      renderTerminalPopup(map, feature);
      return;
    }
    const props = feature?.properties || {};
    const label = props.label || (props.kind === 'start' ? '起点' : '终点');
    const zh = props.zh || label;
    const en = props.en || '';
    setMobileActiveTerminal({
      id,
      label,
      zh,
      en,
      note: props.kind === 'start' ? '路线起点' : '路线终点',
    });
  };

  const createTerminalTapTarget = (terminal: any) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.setAttribute('aria-label', `${terminal.properties?.label || '地点'} ${terminal.properties?.zh || ''}`.trim());
    element.style.width = '32px';
    element.style.height = '32px';
    element.style.padding = '0';
    element.style.margin = '0';
    element.style.border = '0';
    element.style.background = 'transparent';
    element.style.opacity = '0';
    element.style.pointerEvents = desktopHoverCapableRef.current ? 'none' : 'auto';
    element.style.touchAction = 'none';
    element.style.cursor = 'pointer';

    const stopNativeEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof (event as any).stopImmediatePropagation === 'function') {
        (event as any).stopImmediatePropagation();
      }
    };

    const handleMobileTap = (event: Event) => {
      stopNativeEvent(event);
      if (desktopHoverCapableRef.current) return;
      const map = mapRef.current;
      if (!map) return;
      const now = Date.now();
      const terminalId = terminal.id as string | number;
      const lastTap = lastMobileTapRef.current;
      if (lastTap && lastTap.id === terminalId && now - lastTap.time < 450) return;
      lastMobileTapRef.current = { id: terminalId, time: now };
      suppressUpcomingMapClick();
      if (selectedTerminalIdRef.current === terminalId) {
        clearTerminalPopup();
        clearTerminalState(map);
        setMobileActiveTerminal(null);
        return;
      }
      setSelectedTerminal(map, terminal);
    };

    element.addEventListener('touchstart', stopNativeEvent, { passive: false });
    element.addEventListener('touchend', handleMobileTap, { passive: false });
    element.addEventListener('pointerdown', (event) => {
      if ((event as PointerEvent).pointerType === 'mouse') return;
      stopNativeEvent(event);
    });
    element.addEventListener('pointerup', (event) => {
      if ((event as PointerEvent).pointerType === 'mouse') return;
      handleMobileTap(event);
    });
    element.addEventListener('click', (event) => {
      if (desktopHoverCapableRef.current) return;
      handleMobileTap(event);
    });

    return element;
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DESKTOP_HOVER_QUERY);
    const sync = () => {
      desktopHoverCapableRef.current = media.matches;
      setIsDesktopHoverCapable(media.matches);
      if (media.matches) setMobileActiveTerminal(null);
      terminalTapMarkersRef.current.forEach((marker) => {
        const el = marker.getElement() as HTMLElement;
        el.style.pointerEvents = media.matches ? 'none' : 'auto';
      });
    };
    sync();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const coarseMedia =
      typeof window.matchMedia === 'function' ? window.matchMedia(NON_HOVER_QUERY) : null;

    const sync = () => {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { msMaxTouchPoints?: number }) : null;
      const hasTouch =
        Boolean(nav) && ((nav?.maxTouchPoints ?? 0) > 0 || (nav?.msMaxTouchPoints ?? 0) > 0);
      const shouldReduceMotion = Boolean(coarseMedia?.matches) || hasTouch;
      setPrefersReducedRouteMotion(shouldReduceMotion);
    };

    sync();
    if (!coarseMedia) return;
    if (typeof coarseMedia.addEventListener === 'function') {
      coarseMedia.addEventListener('change', sync);
      return () => coarseMedia.removeEventListener('change', sync);
    }
    coarseMedia.addListener(sync);
    return () => coarseMedia.removeListener(sync);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-8.55, 42.88],
      zoom: 5,
      attributionControl: { compact: false },
    });
    map.scrollZoom.enable();
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    const handleResize = () => map.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      abortActiveRequest('map unmount');
      clearBadgeTimers();
      clearSettleWatcher();
      clearTerminalPopup();
      clearMapClickSuppression();
      removeTerminalTapMarkers();
      setMobileActiveTerminal(null);
      if (onTerminalEnterRef.current) map.off('mouseenter', TERMINAL_CORE_LAYER_ID, onTerminalEnterRef.current);
      if (onTerminalLeaveRef.current) map.off('mouseleave', TERMINAL_CORE_LAYER_ID, onTerminalLeaveRef.current);
      if (onTerminalClickRef.current) map.off('click', TERMINAL_CORE_LAYER_ID, onTerminalClickRef.current);
      if (onMapClickRef.current) map.off('click', onMapClickRef.current);
      if (onMapDragStartRef.current) map.off('dragstart', onMapDragStartRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !variant?.geometry_path) {
      requestedSwitchRef.current = null;
      queuedSwitchRef.current = null;
      setIsRouteRequestPending(false);
      setHasAppliedSelectedRoute(false);
      clearBadgeTimers();
      clearSettleWatcher();
      setShowLoadingBadge(false);
      setShowSlowHint(false);
      setShowRetryHint(false);
      return;
    }

    const nextSwitch: QueuedRouteSwitch = {
      variant,
      reason: switchInFlightRef.current ? 'queued' : 'requested',
    };
    requestedSwitchRef.current = nextSwitch;

    if (!switchInFlightRef.current && lastAppliedPathRef.current === variant.geometry_path) {
      setError('');
      setIsRouteRequestPending(false);
      setHasAppliedSelectedRoute(true);
      clearBadgeTimers();
      setShowLoadingBadge(false);
      setShowSlowHint(false);
      setShowRetryHint(false);
      onRenderedVariantChangeRef.current?.(variant.id);
      routeDebug('renderedVariantId sync', {
        token: requestSeqRef.current,
        renderedVariantId: variant.id,
        source: 'already-applied',
      });
      return;
    }

    if (switchInFlightRef.current) {
      const active = activeRequestRef.current;
      if (active && active.variantId !== variant.id) {
        queuedSwitchRef.current = { variant, reason: 'queued' };
        routeDebug('queued replacement set', {
          activeVariantId: active.variantId,
          queuedVariantId: variant.id,
          selectedVariantId,
          renderedVariantId,
        });
      }
      return;
    }

    const applyPreparedRoute = async (
      currentMap: maplibregl.Map,
      requestId: number,
      nextVariant: RouteVariant,
      prepared: PreparedRouteData,
    ) => {
      clearTerminalPopup();
      clearMapClickSuppression();
      clearTerminalState(currentMap);
      setMobileActiveTerminal(null);
      removeTerminalTapMarkers();

      const source = currentMap.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(prepared.routeData);
      } else {
        currentMap.addSource(SOURCE_ID, { type: 'geojson', data: prepared.routeData });
        currentMap.addLayer({
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': '#3f8cff',
            'line-width': 4,
            'line-opacity': 0.92,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }

      if (ENABLE_TERMINALS) {
        const terminalSource = currentMap.getSource(TERMINAL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (terminalSource) {
          terminalSource.setData(prepared.terminalData);
        } else {
          currentMap.addSource(TERMINAL_SOURCE_ID, { type: 'geojson', data: prepared.terminalData });
          currentMap.addLayer({
            id: TERMINAL_GLOW_LAYER_ID,
            type: 'circle',
            source: TERMINAL_SOURCE_ID,
            paint: {
              'circle-radius': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                ['match', ['get', 'kind'], 'start', 9.8 * TERMINAL_HOVER_SCALE, 9.8 * TERMINAL_HOVER_SCALE],
                ['match', ['get', 'kind'], 'start', 9.8, 9.8],
              ],
              'circle-color': ['match', ['get', 'kind'], 'start', 'rgba(95, 149, 255, 0.18)', 'rgba(255, 155, 92, 0.18)'],
              'circle-opacity': 1,
              'circle-blur': 0.42,
            },
          });
          currentMap.addLayer({
            id: TERMINAL_INNER_LAYER_ID,
            type: 'circle',
            source: TERMINAL_SOURCE_ID,
            paint: {
              'circle-radius': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                ['match', ['get', 'kind'], 'start', 6.1 * TERMINAL_HOVER_SCALE, 6.2 * TERMINAL_HOVER_SCALE],
                ['match', ['get', 'kind'], 'start', 6.1, 6.2],
              ],
              'circle-color': ['match', ['get', 'kind'], 'start', '#5f95ff', '#ff9b5c'],
              'circle-opacity': 0.96,
            },
          });
          currentMap.addLayer({
            id: TERMINAL_CORE_LAYER_ID,
            type: 'circle',
            source: TERMINAL_SOURCE_ID,
            paint: {
              'circle-radius': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                ['match', ['get', 'kind'], 'start', 3.5 * TERMINAL_HOVER_SCALE, 3.6 * TERMINAL_HOVER_SCALE],
                ['match', ['get', 'kind'], 'start', 3.5, 3.6],
              ],
              'circle-color': ['match', ['get', 'kind'], 'start', '#bcd3ff', '#ffd0a8'],
              'circle-stroke-color': 'rgba(255, 255, 255, 0.18)',
              'circle-stroke-width': 0.5,
            },
          });
          currentMap.addLayer({
            id: `${TERMINAL_CORE_LAYER_ID}-highlight`,
            type: 'circle',
            source: TERMINAL_SOURCE_ID,
            paint: {
              'circle-radius': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                ['match', ['get', 'kind'], 'start', 1.38 * TERMINAL_HOVER_SCALE, 1.46 * TERMINAL_HOVER_SCALE],
                ['match', ['get', 'kind'], 'start', 1.38, 1.46],
              ],
              'circle-color': ['match', ['get', 'kind'], 'start', '#eef4ff', '#fff4ea'],
              'circle-opacity': 0.98,
            },
          });
          (currentMap as any).setPaintProperty(
            TERMINAL_GLOW_LAYER_ID,
            'circle-radius-transition',
            { duration: TERMINAL_HOVER_DURATION, delay: 0 },
          );
          (currentMap as any).setPaintProperty(
            TERMINAL_INNER_LAYER_ID,
            'circle-radius-transition',
            { duration: TERMINAL_HOVER_DURATION, delay: 0 },
          );
          (currentMap as any).setPaintProperty(
            TERMINAL_CORE_LAYER_ID,
            'circle-radius-transition',
            { duration: TERMINAL_HOVER_DURATION, delay: 0 },
          );
          (currentMap as any).setPaintProperty(
            `${TERMINAL_CORE_LAYER_ID}-highlight`,
            'circle-radius-transition',
            { duration: TERMINAL_HOVER_DURATION, delay: 0 },
          );
        }

        if (SHOW_DEBUG_TERMINALS) {
          const debugData = {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: prepared.renderedStart } },
              { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: prepared.renderedEnd } },
            ],
          } as any;
          const debugSource = currentMap.getSource('route-terminals-debug') as maplibregl.GeoJSONSource | undefined;
          if (debugSource) debugSource.setData(debugData);
          else {
            currentMap.addSource('route-terminals-debug', { type: 'geojson', data: debugData });
            currentMap.addLayer({
              id: 'route-terminals-debug-layer',
              type: 'circle',
              source: 'route-terminals-debug',
              paint: {
                'circle-radius': 3,
                'circle-color': ['match', ['get', 'kind'], 'start', '#00ff00', '#ff0000'],
              },
            });
          }
        } else {
          if (currentMap.getLayer('route-terminals-debug-layer')) currentMap.removeLayer('route-terminals-debug-layer');
          if (currentMap.getSource('route-terminals-debug')) currentMap.removeSource('route-terminals-debug');
        }

        prepared.terminalData.features.forEach((terminal: any) => {
          const tapMarker = new maplibregl.Marker({
            element: createTerminalTapTarget(terminal),
            anchor: 'center',
          })
            .setLngLat(terminal.geometry.coordinates as LngLat)
            .addTo(currentMap);
          terminalTapMarkersRef.current.push(tapMarker);
        });

        if (!onTerminalEnterRef.current) {
          const onEnter = (e: any) => {
            if (!desktopHoverCapableRef.current) return;
            if (hidePopupTimerRef.current !== null) {
              window.clearTimeout(hidePopupTimerRef.current);
              hidePopupTimerRef.current = null;
            }
            const feature = e?.features?.[0];
            if (!feature) return;
            const id = feature.id as string | number | undefined;
            if (selectedTerminalIdRef.current !== null) return;
            if (hoveredTerminalIdRef.current !== null && hoveredTerminalIdRef.current !== id) {
              currentMap.setFeatureState(
                { source: TERMINAL_SOURCE_ID, id: hoveredTerminalIdRef.current },
                { hover: false },
              );
            }
            if (id !== undefined) {
              hoveredTerminalIdRef.current = id;
              currentMap.setFeatureState({ source: TERMINAL_SOURCE_ID, id }, { hover: true });
            }
            currentMap.getCanvas().style.cursor = 'pointer';
            renderTerminalPopup(currentMap, feature);
          };
          const onLeave = (e: any) => {
            if (!desktopHoverCapableRef.current) return;
            const feature = e?.features?.[0];
            const id = feature?.id as string | number | undefined;
            if (id !== undefined) {
              currentMap.setFeatureState({ source: TERMINAL_SOURCE_ID, id }, { hover: false });
              if (hoveredTerminalIdRef.current === id) hoveredTerminalIdRef.current = null;
            }
            currentMap.getCanvas().style.cursor = '';
            if (hidePopupTimerRef.current !== null) {
              window.clearTimeout(hidePopupTimerRef.current);
            }
            hidePopupTimerRef.current = window.setTimeout(() => {
              clearTerminalPopup();
            }, TERMINAL_POPUP_HIDE_DELAY);
          };
          const onTerminalClick = (e: any) => {
            const feature = e?.features?.[0];
            if (!feature || desktopHoverCapableRef.current) return;
            if (typeof e?.preventDefault === 'function') e.preventDefault();
            suppressUpcomingMapClick();
            setSelectedTerminal(currentMap, feature);
          };
          const onMapClick = (e: any) => {
            if (desktopHoverCapableRef.current) return;
            if (suppressNextMapClickRef.current) {
              clearMapClickSuppression();
              return;
            }
            const features = currentMap.queryRenderedFeatures(e.point, { layers: [TERMINAL_CORE_LAYER_ID] });
            if (features.length) return;
            clearTerminalPopup();
            clearTerminalState(currentMap);
            setMobileActiveTerminal(null);
          };
          const onMapDragStart = () => {
            if (desktopHoverCapableRef.current) return;
            clearTerminalPopup();
            clearTerminalState(currentMap);
            setMobileActiveTerminal(null);
          };
          currentMap.on('mouseenter', TERMINAL_CORE_LAYER_ID, onEnter);
          currentMap.on('mouseleave', TERMINAL_CORE_LAYER_ID, onLeave);
          currentMap.on('click', TERMINAL_CORE_LAYER_ID, onTerminalClick);
          currentMap.on('click', onMapClick);
          currentMap.on('dragstart', onMapDragStart);
          onTerminalEnterRef.current = onEnter;
          onTerminalLeaveRef.current = onLeave;
          onTerminalClickRef.current = onTerminalClick;
          onMapClickRef.current = onMapClick;
          onMapDragStartRef.current = onMapDragStart;
        }
      }

      routeDebug('route data applied', {
        token: requestId,
        variantId: nextVariant.id,
      });
      currentMap.fitBounds(prepared.renderedBounds, {
        padding: 40,
        duration: prefersReducedRouteMotion ? MOBILE_FIT_BOUNDS_DURATION : DESKTOP_FIT_BOUNDS_DURATION,
      });
      await waitForRouteRenderSettlement(currentMap, requestId);
    };

    const loadPreparedRoute = async (
      requestId: number,
      nextVariant: RouteVariant,
      signal: AbortSignal,
    ) => {
      throwIfAborted(signal);
      const cached = routeCacheRef.current.get(nextVariant.geometry_path);
      const geometrySummary = getRouteGeometryDebugSummary(nextVariant.geometry_path);
      if (cached) return cached;
      routeDebug('fetch start', {
        token: requestId,
        variantId: nextVariant.id,
        geometryPath: nextVariant.geometry_path,
        originalBytes: geometrySummary?.sourceFileBytes ?? null,
        optimizedBytes: geometrySummary?.optimizedFileBytes ?? null,
        coordinateCount: geometrySummary?.coordinateCount ?? null,
      });
      const rawGeojson = await loadRouteGeometry(nextVariant.geometry_path);
      throwIfAborted(signal);
      routeDebug('fetch success', {
        token: requestId,
        variantId: nextVariant.id,
        source: geometrySummary ? 'optimized-manifest' : 'runtime-fetch',
      });
      const prepared = prepareRouteData(nextVariant, rawGeojson);
      routeCacheRef.current.set(nextVariant.geometry_path, prepared);
      return prepared;
    };

    const runSwitchLoop = async () => {
      if (processLoopPromiseRef.current || switchInFlightRef.current) return;
      processLoopPromiseRef.current = (async () => {
        while (requestedSwitchRef.current?.variant.geometry_path) {
          const pending = requestedSwitchRef.current;
          requestedSwitchRef.current = null;
          queuedSwitchRef.current = null;
          if (!pending) break;

          const nextVariant = pending.variant;
          if (lastAppliedPathRef.current === nextVariant.geometry_path) {
            setError('');
            setIsRouteRequestPending(false);
            setHasAppliedSelectedRoute(true);
            clearBadgeTimers();
            setShowLoadingBadge(false);
            setShowSlowHint(false);
            setShowRetryHint(false);
            onRenderedVariantChangeRef.current?.(nextVariant.id);
            routeDebug('renderedVariantId sync', {
              token: requestSeqRef.current,
              renderedVariantId: nextVariant.id,
              source: 'already-applied',
            });
            continue;
          }

          const requestId = requestSeqRef.current + 1;
          requestSeqRef.current = requestId;
          const abortController = new AbortController();
          activeRequestRef.current = {
            token: requestId,
            variantId: nextVariant.id,
            geometryPath: nextVariant.geometry_path,
            controller: abortController,
          };
          switchInFlightRef.current = true;
          setError('');
          setIsRouteRequestPending(true);
          beginRequestProgress(requestId);
          logRouteGeometryTable(ENABLE_ROUTE_DEBUG);
          logRouteGeometrySummary(nextVariant.geometry_path, ENABLE_ROUTE_DEBUG);
          routeDebug(pending.reason === 'queued' ? 'queued switch started' : 'switch started', {
            token: requestId,
            selectedVariantId,
            renderedVariantId,
            variantId: nextVariant.id,
            geometryPath: nextVariant.geometry_path,
          });

          try {
            const currentMap = mapRef.current;
            if (!currentMap) throw createAbortError();
            await waitForAnimationFrames(2, abortController.signal);
            await waitForMapStyleLoad(currentMap, abortController.signal);
            const prepared = await loadPreparedRoute(requestId, nextVariant, abortController.signal);
            throwIfAborted(abortController.signal);
            await applyPreparedRoute(currentMap, requestId, nextVariant, prepared);
            throwIfAborted(abortController.signal);
            lastAppliedPathRef.current = nextVariant.geometry_path;
            finalizeRequestProgress(requestId);
            routeDebug('map settled', {
              token: requestId,
              variantId: nextVariant.id,
            });
            routeDebug('renderedVariantId sync', {
              token: requestId,
              renderedVariantId: nextVariant.id,
              source: 'render-settled',
            });
            onRenderedVariantChangeRef.current?.(nextVariant.id);
          } catch (err: unknown) {
            if (isAbortLikeError(err)) {
              routeDebug('fetch abort', {
                token: requestId,
                variantId: nextVariant.id,
                reason: 'AbortController',
              });
            } else {
              clearSettleWatcher();
              setError('新线路加载失败，请重试');
              setIsRouteRequestPending(false);
              setHasAppliedSelectedRoute(false);
              routeDebug('fetch error', {
                token: requestId,
                variantId: nextVariant.id,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          } finally {
            clearSettleWatcher();
            if (activeRequestRef.current?.token === requestId) {
              activeRequestRef.current = null;
            }
            switchInFlightRef.current = false;
            const queued = queuedSwitchRef.current as QueuedRouteSwitch | null;
            if (queued && queued.variant.id !== nextVariant.id) {
              requestedSwitchRef.current = queued;
              queuedSwitchRef.current = null;
            }
          }
        }
      })().finally(() => {
        processLoopPromiseRef.current = null;
      });

      await processLoopPromiseRef.current;
    };

    void runSwitchLoop();
  }, [prefersReducedRouteMotion, renderedVariantId, selectedVariantId, variant]);

  const hasPendingMapWork =
    selectedVariantId !== renderedVariantId || isRouteRequestPending || !hasAppliedSelectedRoute;
  const showStatusBadge = hasPendingMapWork && (selectedVariantId !== renderedVariantId || showLoadingBadge);

  return (
    <div className="map-view">
      <div className="map-canvas real-map" ref={containerRef}>
        {error ? <div className="map-placeholder">{error}</div> : null}
        <div
          className={`map-status-badge ${showStatusBadge ? 'visible' : ''}`}
          aria-hidden={!showStatusBadge}
          aria-live="polite"
          role="status"
        >
          <span className="map-status-badge-title">切换中</span>
          {showSlowHint ? <span className="map-status-badge-note">长线路加载中</span> : null}
          {showRetryHint ? <span className="map-status-badge-note">网络较慢，可再试一次</span> : null}
        </div>
        {ENABLE_TERMINALS && !isDesktopHoverCapable && mobileActiveTerminal ? (
          <div
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              width: 'min(280px, calc(100% - 84px))',
              maxWidth: 'calc(100% - 84px)',
              zIndex: 12,
              pointerEvents: 'auto',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              background: 'rgba(9, 18, 34, 0.86)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 10px 24px rgba(3, 9, 18, 0.28)',
              padding: '10px 12px',
            }}
          >
            <button
              type="button"
              aria-label="关闭地点信息"
              onClick={(event) => {
                event.stopPropagation();
                clearTerminalPopup();
                clearTerminalState();
                setMobileActiveTerminal(null);
              }}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 24,
                height: 24,
                border: 0,
                borderRadius: '999px',
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'rgba(232, 242, 255, 0.82)',
                fontSize: '16px',
                lineHeight: 1,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ×
            </button>
            <div
              style={{
                fontSize: '11px',
                letterSpacing: '0.04em',
                color: 'rgba(255, 255, 255, 0.62)',
                marginBottom: 4,
                paddingRight: 28,
              }}
            >
              {mobileActiveTerminal.label}
            </div>
            <div
              style={{
                fontSize: '14px',
                lineHeight: 1.35,
                color: '#ffffff',
                paddingRight: 28,
              }}
            >
              {mobileActiveTerminal.zh}
            </div>
            {mobileActiveTerminal.en ? (
              <div
                style={{
                  marginTop: 3,
                  fontSize: '12px',
                  lineHeight: 1.35,
                  color: 'rgba(255, 255, 255, 0.78)',
                }}
              >
                {mobileActiveTerminal.en}
              </div>
            ) : null}
            <div
              style={{
                marginTop: 6,
                fontSize: '11px',
                lineHeight: 1.4,
                color: 'rgba(205, 221, 243, 0.72)',
              }}
            >
              {mobileActiveTerminal.note}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
