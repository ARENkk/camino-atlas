import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const GEO_DIR = path.join(ROOT, 'public', 'geo');

const FULL_ROUTE_FILE = path.join(GEO_DIR, 'camino-frances-full.geojson');
const SARRIA_OUTPUT_FILE = path.join(GEO_DIR, 'camino-frances-sarria.geojson');
const FINISTERRE_OUTPUT_FILE = path.join(GEO_DIR, 'camino-finisterre.geojson');

const SARRIA = [-7.4149, 42.7817];
const SANTIAGO = [-8.5448, 42.8782];

function flattenLineCoords(geojson) {
  const coords = [];
  for (const feature of geojson.features ?? []) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    if (geometry.type === 'LineString') {
      coords.push(...geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) coords.push(...line);
    }
  }
  return coords;
}

function distanceSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function nearestIndex(coords, target) {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i += 1) {
    const d = distanceSq(coords[i], target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function writeFeatureCollection(filePath, lineCoords, props = {}) {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: props,
        geometry: { type: 'LineString', coordinates: lineCoords }
      }
    ]
  };
  fs.writeFileSync(filePath, JSON.stringify(geojson));
}

function buildSarriaSegment() {
  const full = JSON.parse(fs.readFileSync(FULL_ROUTE_FILE, 'utf8'));
  const coords = flattenLineCoords(full).filter(
    (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
  );
  if (coords.length < 2) {
    throw new Error('Could not extract enough coordinates from camino-frances-full.geojson');
  }

  const sarriaIndex = nearestIndex(coords, SARRIA);
  const santiagoIndex = nearestIndex(coords, SANTIAGO);
  const start = Math.min(sarriaIndex, santiagoIndex);
  const end = Math.max(sarriaIndex, santiagoIndex);
  let segment = coords.slice(start, end + 1);
  if (segment.length < 2) throw new Error('Sarria segment is too short after slicing');

  const startDistToSarria = distanceSq(segment[0], SARRIA);
  const startDistToSantiago = distanceSq(segment[0], SANTIAGO);
  if (startDistToSantiago < startDistToSarria) {
    segment = [...segment].reverse();
  }

  writeFeatureCollection(SARRIA_OUTPUT_FILE, segment, {
    name: 'Camino Frances last 100km (Sarria to Santiago)',
    source: 'derived-from-camino-frances-full'
  });
}

function interpolatePolyline(waypoints, pointsPerSegment = 10) {
  const output = [];
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const [x1, y1] = waypoints[i];
    const [x2, y2] = waypoints[i + 1];
    for (let t = 0; t < pointsPerSegment; t += 1) {
      const ratio = t / pointsPerSegment;
      const x = x1 + (x2 - x1) * ratio;
      const y = y1 + (y2 - y1) * ratio;
      const wiggle = Math.sin((i + ratio) * Math.PI * 1.7) * 0.008;
      output.push([x + wiggle, y - wiggle * 0.6]);
    }
  }
  output.push(waypoints[waypoints.length - 1]);
  return output;
}

function buildFinisterreRoute() {
  const waypoints = [
    [-8.5448, 42.8782], // Santiago
    [-8.6605, 42.9074], // Ames
    [-8.736, 42.9095], // Negreira
    [-8.8892, 42.9988], // A Pena
    [-9.0373, 42.9884], // Olveiroa
    [-9.1491, 42.9587], // Cee
    [-9.2058, 42.9648], // Corcubion
    [-9.2652, 42.9079] // Fisterra
  ];

  const coords = interpolatePolyline(waypoints, 12);
  writeFeatureCollection(FINISTERRE_OUTPUT_FILE, coords, {
    name: 'Camino Finisterre (Santiago to Fisterra)',
    source: 'generated-waypoint-polyline'
  });
}

buildSarriaSegment();
buildFinisterreRoute();
console.log('Generated camino-frances-sarria.geojson and camino-finisterre.geojson');

