import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const routesPath = path.join(repoRoot, 'data', 'routes.json');
const publicGeoDir = path.join(repoRoot, 'public', 'geo');
const outputDir = path.join(repoRoot, 'src', 'data', 'route-geo');
const statsOutPath = path.join(repoRoot, 'src', 'data', 'route-geometry-stats.json');

const OPTIMIZATION_RULES = [
  { test: /via-de-la-plata/i, tolerance: 0.00055, decimals: 5 },
  { test: /camino-del-norte/i, tolerance: 0.0005, decimals: 5 },
  { test: /camino-frances-full/i, tolerance: 0.00045, decimals: 5 },
  { test: /camino-finisterre/i, tolerance: 0.00045, decimals: 5 },
  { test: /camino-primitivo/i, tolerance: 0.00038, decimals: 5 },
  { test: /camino-portugues/i, tolerance: 0.00025, decimals: 5 },
  { test: /camino-ingles/i, tolerance: 0.00018, decimals: 5 },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function roundCoord(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sqSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDistance = sqTolerance;
  let index = -1;

  for (let i = first + 1; i < last; i += 1) {
    const sqDistance = sqSegmentDistance(points[i], points[first], points[last]);
    if (sqDistance > maxSqDistance) {
      index = i;
      maxSqDistance = sqDistance;
    }
  }

  if (index > -1) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

function simplifyLine(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2) return points;
  const sqTolerance = tolerance * tolerance;
  const simplified = [points[0]];
  simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
  simplified.push(points[points.length - 1]);
  return simplified;
}

function countCoordsInGeometry(geometry) {
  if (!geometry || !geometry.type) return 0;
  if (geometry.type === 'LineString') return Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
  if (geometry.type === 'MultiLineString') {
    return Array.isArray(geometry.coordinates)
      ? geometry.coordinates.reduce((sum, line) => sum + (Array.isArray(line) ? line.length : 0), 0)
      : 0;
  }
  if (geometry.type === 'Point') return 1;
  if (geometry.type === 'MultiPoint') return Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
  if (geometry.type === 'GeometryCollection') {
    return Array.isArray(geometry.geometries)
      ? geometry.geometries.reduce((sum, item) => sum + countCoordsInGeometry(item), 0)
      : 0;
  }
  return 0;
}

function transformGeometry(geometry, tolerance, decimals) {
  if (!geometry || !geometry.type) return geometry;

  if (geometry.type === 'LineString') {
    const simplified = simplifyLine(geometry.coordinates, tolerance).map(([lng, lat]) => [
      roundCoord(lng, decimals),
      roundCoord(lat, decimals),
    ]);
    return { ...geometry, coordinates: simplified };
  }

  if (geometry.type === 'MultiLineString') {
    const simplified = geometry.coordinates.map((line) =>
      simplifyLine(line, tolerance).map(([lng, lat]) => [
        roundCoord(lng, decimals),
        roundCoord(lat, decimals),
      ]),
    );
    return { ...geometry, coordinates: simplified };
  }

  if (geometry.type === 'Point') {
    return {
      ...geometry,
      coordinates: [roundCoord(geometry.coordinates[0], decimals), roundCoord(geometry.coordinates[1], decimals)],
    };
  }

  if (geometry.type === 'GeometryCollection') {
    return {
      ...geometry,
      geometries: geometry.geometries.map((item) => transformGeometry(item, tolerance, decimals)),
    };
  }

  return geometry;
}

function simplifyFeatureCollection(source, tolerance, decimals) {
  if (source?.type !== 'FeatureCollection' || !Array.isArray(source.features)) return source;
  return {
    ...source,
    features: source.features.map((feature) => ({
      ...feature,
      geometry: transformGeometry(feature.geometry, tolerance, decimals),
    })),
  };
}

function getRule(filename) {
  return OPTIMIZATION_RULES.find((rule) => rule.test.test(filename)) ?? { tolerance: 0.00025, decimals: 5 };
}

function toStats({ filename, routePath, source, optimized, tolerance, decimals, sourceFileBytes, optimizedFileBytes }) {
  const featureCount = Array.isArray(source.features) ? source.features.length : 0;
  const coordinateCount = Array.isArray(source.features)
    ? source.features.reduce((sum, feature) => sum + countCoordsInGeometry(feature.geometry), 0)
    : 0;
  const optimizedCoordinateCount = Array.isArray(optimized.features)
    ? optimized.features.reduce((sum, feature) => sum + countCoordsInGeometry(feature.geometry), 0)
    : 0;

  return {
    filename,
    routePath,
    featureCount,
    coordinateCount,
    optimizedCoordinateCount,
    sourceFileBytes,
    optimizedFileBytes,
    reducedBytes: sourceFileBytes - optimizedFileBytes,
    reductionRatio: sourceFileBytes > 0 ? Number(((sourceFileBytes - optimizedFileBytes) / sourceFileBytes).toFixed(4)) : 0,
    tolerance,
    decimals,
  };
}

function main() {
  ensureDir(outputDir);

  const atlas = readJson(routesPath);
  const routePaths = Array.from(
    new Set(
      atlas.routeVariants
        .map((variant) => variant.geometry_path)
        .filter((value) => typeof value === 'string' && value.endsWith('.geojson')),
    ),
  );

  const summaries = [];

  for (const routePath of routePaths) {
    const filename = path.basename(routePath);
    const sourcePath = path.join(publicGeoDir, filename);
    if (!fs.existsSync(sourcePath)) continue;
    const source = readJson(sourcePath);
    const { tolerance, decimals } = getRule(filename);
    const optimized = simplifyFeatureCollection(source, tolerance, decimals);
    const outputFilename = filename.replace(/\.geojson$/i, '.optimized.json');
    const outputPath = path.join(outputDir, outputFilename);
    writeJson(outputPath, optimized);
    summaries.push(
      toStats({
        filename,
        routePath,
        source,
        optimized,
        tolerance,
        decimals,
        sourceFileBytes: fs.statSync(sourcePath).size,
        optimizedFileBytes: fs.statSync(outputPath).size,
      }),
    );
  }

  summaries.sort((a, b) => b.sourceFileBytes - a.sourceFileBytes);
  writeJson(statsOutPath, {
    generatedAt: new Date().toISOString(),
    routes: summaries,
  });

  console.table(
    summaries.map((item) => ({
      file: item.filename,
      kb: Number((item.sourceFileBytes / 1024).toFixed(1)),
      optimizedKb: Number((item.optimizedFileBytes / 1024).toFixed(1)),
      reductionPct: Number((item.reductionRatio * 100).toFixed(1)),
      features: item.featureCount,
      coords: item.coordinateCount,
      optimizedCoords: item.optimizedCoordinateCount,
    })),
  );
}

main();
