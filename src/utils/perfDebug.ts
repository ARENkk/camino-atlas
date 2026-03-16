type PerfData = Record<string, unknown> | undefined;

type PerfStore = {
  startTime: number;
  initialized: boolean;
};

declare global {
  interface Window {
    __CAMINO_PERF_DEBUG__?: boolean;
    __CAMINO_PERF_STORE__?: PerfStore;
  }
}

const PERF_LOCAL_STORAGE_KEY = 'camino-perf-debug';

function getNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function ensureStore(): PerfStore {
  if (typeof window === 'undefined') {
    return { startTime: getNow(), initialized: false };
  }
  if (!window.__CAMINO_PERF_STORE__) {
    window.__CAMINO_PERF_STORE__ = {
      startTime: getNow(),
      initialized: false,
    };
  }
  return window.__CAMINO_PERF_STORE__;
}

export function isPerfDebugEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__CAMINO_PERF_DEBUG__ === true) return true;
  try {
    return window.localStorage.getItem(PERF_LOCAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function emit(scope: string, event: string, data?: PerfData) {
  if (!isPerfDebugEnabled()) return;
  const store = ensureStore();
  const elapsed = (getNow() - store.startTime).toFixed(1);
  if (data && Object.keys(data).length > 0) {
    console.log(`[Perf][${scope}] +${elapsed}ms ${event}`, data);
    return;
  }
  console.log(`[Perf][${scope}] +${elapsed}ms ${event}`);
}

export function perfInit(scope: string, event: string, data?: PerfData) {
  const store = ensureStore();
  if (store.initialized) {
    emit(scope, event, data);
    return;
  }
  store.startTime = getNow();
  store.initialized = true;
  emit(scope, event, data);
}

export function perfLog(scope: string, event: string, data?: PerfData) {
  ensureStore();
  emit(scope, event, data);
}

export function perfMarkStart() {
  return getNow();
}

export function perfMarkEnd(scope: string, event: string, start: number, data?: PerfData) {
  if (!isPerfDebugEnabled()) return;
  const durationMs = Number((getNow() - start).toFixed(1));
  emit(scope, event, { ...data, durationMs });
}
