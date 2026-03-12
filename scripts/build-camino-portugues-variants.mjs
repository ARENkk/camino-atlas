import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const lisbonPath = path.join(repoRoot, 'public', 'geo', 'camino-portugues-lisbon.geojson');
const portoPath = path.join(repoRoot, 'public', 'geo', 'camino-portugues-porto.geojson');

const LISBON = [-9.142685, 38.736946];
const PORTO = [-8.61157, 41.142789];
const SANTIAGO = [-8.5448, 42.8782];

function sqDist(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function nearestIndex(coords, target) {
  let idx = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i += 1) {
    const d = sqDist(coords[i], target);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}

function readLine(filePath) {
  const fc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const g = fc?.features?.[0]?.geometry;
  if (!g) return [];
  if (g.type === 'LineString') return g.coordinates;
  if (g.type === 'MultiLineString') return g.coordinates.flat();
  return [];
}

function dedupe(coords) {
  if (!coords.length) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const p = coords[i];
    const q = out[out.length - 1];
    if (p[0] === q[0] && p[1] === q[1]) continue;
    out.push(p);
  }
  return out;
}

function loopErase(coords, precision = 5) {
  const out = [];
  const seen = new Map();
  for (const pt of coords) {
    const key = `${pt[0].toFixed(precision)},${pt[1].toFixed(precision)}`;
    if (!seen.has(key)) {
      seen.set(key, out.length);
      out.push(pt);
      continue;
    }
    const keepUntil = seen.get(key);
    while (out.length > keepUntil + 1) {
      const removed = out.pop();
      const rKey = `${removed[0].toFixed(precision)},${removed[1].toFixed(precision)}`;
      seen.delete(rKey);
    }
  }
  return out;
}

function dist(a, b) {
  return Math.sqrt(sqDist(a, b));
}

function removeLocalBacktracks(coords, maxStep = 0.003, cosThreshold = -0.92) {
  if (coords.length < 3) return coords;
  let out = coords.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard < 5) {
    guard += 1;
    changed = false;
    const next = [out[0]];
    for (let i = 1; i < out.length - 1; i += 1) {
      const a = next[next.length - 1];
      const b = out[i];
      const c = out[i + 1];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const bc = [c[0] - b[0], c[1] - b[1]];
      const nab = Math.hypot(ab[0], ab[1]);
      const nbc = Math.hypot(bc[0], bc[1]);
      if (nab === 0 || nbc === 0) {
        changed = true;
        continue;
      }
      const cos = (ab[0] * bc[0] + ab[1] * bc[1]) / (nab * nbc);
      if (cos < cosThreshold && nab < maxStep && nbc < maxStep) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    next.push(out[out.length - 1]);
    out = dedupe(next);
  }
  return out;
}

function nearestPointIndex(line, target) {
  return nearestIndex(line, target);
}

function pickJoin(south, north, southTailWindow = 500, northHeadWindow = 400) {
  const sStart = Math.max(0, south.length - southTailWindow);
  let bestI = south.length - 1;
  let bestK = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = sStart; i < south.length; i += 1) {
    for (let k = 0; k < Math.min(northHeadWindow, north.length); k += 1) {
      const d = dist(south[i], north[k]);
      // Prefer earlier north join while still minimizing geometry gap.
      const score = d + k * 0.00002;
      if (score < bestScore) {
        bestScore = score;
        bestI = i;
        bestK = k;
      }
    }
  }
  return { southIndex: bestI, northIndex: bestK, gap: dist(south[bestI], north[bestK]) };
}

function toFC(coords) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'camino-portugues-lisbon',
          source: 'loop_erased_lisbon_track_plus_clean_porto_track_2026-03-07'
        },
        geometry: {
          type: 'LineString',
          coordinates: coords
        }
      }
    ]
  };
}

function main() {
  const lisRaw = readLine(lisbonPath);
  const porRaw = readLine(portoPath);
  if (lisRaw.length < 1000 || porRaw.length < 1000) {
    throw new Error('Portuguese source tracks too short.');
  }

  const lisStart = nearestIndex(lisRaw, LISBON);
  const lisPorto = nearestIndex(lisRaw, PORTO);
  let lisbonToPorto =
    lisStart <= lisPorto
      ? lisRaw.slice(lisStart, lisPorto + 1)
      : lisRaw.slice(lisPorto, lisStart + 1).reverse();

  // South segment only: remove loops and local foldbacks before joining Porto baseline.
  lisbonToPorto = removeLocalBacktracks(loopErase(dedupe(lisbonToPorto), 5));

  const porStart = nearestIndex(porRaw, PORTO);
  const porEnd = nearestIndex(porRaw, SANTIAGO);
  let portoToSantiago =
    porStart <= porEnd ? porRaw.slice(porStart, porEnd + 1) : porRaw.slice(porEnd, porStart + 1).reverse();
  portoToSantiago = dedupe(portoToSantiago);

  // Single connection near Porto: trim south tail and north head once, then stitch.
  const join = pickJoin(lisbonToPorto, portoToSantiago);
  let south = lisbonToPorto.slice(0, join.southIndex + 1);
  let north = portoToSantiago.slice(join.northIndex);

  // If still offset at join, keep one connector point only (no local zig-zag).
  if (dist(south[south.length - 1], north[0]) < 0.01) {
    while (south.length > 1 && dist(south[south.length - 2], north[0]) < dist(south[south.length - 1], north[0])) {
      south.pop();
    }
  }

  const merged = dedupe([...south, ...north.slice(1)]);
  fs.writeFileSync(lisbonPath, `${JSON.stringify(toFC(merged))}\n`);
  console.log('lisbon points', merged.length, 'joinGap', join.gap, 'southPts', south.length, 'northPts', north.length);
}

main();
