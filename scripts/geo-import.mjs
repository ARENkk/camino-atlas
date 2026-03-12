import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const importDir = path.join(repoRoot, 'data', 'import');
const outputDir = path.join(repoRoot, 'public', 'geo');
const routesPath = path.join(repoRoot, 'data', 'routes.json');

const GEO_PATH_BY_VARIANT = {
  'camino-portugues-main': '/geo/camino-portugues.geojson',
  'camino-del-norte-main': '/geo/camino-del-norte.geojson',
  'camino-primitivo-main': '/geo/camino-primitivo.geojson',
  'via-de-la-plata-main': '/geo/via-de-la-plata.geojson',
  'camino-ingles-main': '/geo/camino-ingles.geojson'
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseGpx(content) {
  const segments = [];
  const segRegex = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
  const ptRegex = /<trkpt\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>/gi;
  let segMatch;
  while ((segMatch = segRegex.exec(content))) {
    const points = [];
    let ptMatch;
    while ((ptMatch = ptRegex.exec(segMatch[1]))) {
      points.push([Number(ptMatch[2]), Number(ptMatch[1])]);
    }
    if (points.length > 1) segments.push(points);
  }

  if (segments.length === 0) {
    const points = [];
    let ptMatch;
    while ((ptMatch = ptRegex.exec(content))) {
      points.push([Number(ptMatch[2]), Number(ptMatch[1])]);
    }
    if (points.length > 1) segments.push(points);
  }

  if (segments.length === 0) {
    const rteRegex = /<rtept\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>/gi;
    const points = [];
    let rteMatch;
    while ((rteMatch = rteRegex.exec(content))) {
      points.push([Number(rteMatch[2]), Number(rteMatch[1])]);
    }
    if (points.length > 1) segments.push(points);
  }

  return segments;
}

function parseKml(content) {
  const segments = [];
  const coordsRegex = /<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/gi;
  let coordMatch;
  while ((coordMatch = coordsRegex.exec(content))) {
    const values = coordMatch[1].trim().split(/\s+/);
    const points = [];
    for (const value of values) {
      const [lng, lat] = value.split(',');
      if (!lng || !lat) continue;
      points.push([Number(lng), Number(lat)]);
    }
    if (points.length > 1) segments.push(points);
  }
  return segments;
}

function toFeatureCollection(slug, segments, sourceFile) {
  const geometry =
    segments.length === 1
      ? { type: 'LineString', coordinates: segments[0] }
      : { type: 'MultiLineString', coordinates: segments };

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: slug,
          source_file: sourceFile
        },
        geometry
      }
    ]
  };
}

function convertFile(fileName) {
  const fullPath = path.join(importDir, fileName);
  const ext = path.extname(fileName).toLowerCase();
  const slug = path.basename(fileName, ext).toLowerCase();
  const raw = fs.readFileSync(fullPath, 'utf8');

  const segments = ext === '.gpx' ? parseGpx(raw) : parseKml(raw);
  if (segments.length === 0) {
    throw new Error(`No route geometry parsed from ${fileName}`);
  }

  const geojson = toFeatureCollection(slug, segments, fileName);
  const outputPath = path.join(outputDir, `${slug}.geojson`);
  fs.writeFileSync(outputPath, JSON.stringify(geojson));
  return outputPath;
}

function updateRoutesGeometryPaths() {
  const routesRaw = fs.readFileSync(routesPath, 'utf8');
  const routes = JSON.parse(routesRaw);
  let changed = false;
  for (const variant of routes.routeVariants ?? []) {
    const targetPath = GEO_PATH_BY_VARIANT[variant.id];
    if (!targetPath) continue;
    if (variant.geometry_path !== targetPath) {
      variant.geometry_path = targetPath;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(routesPath, `${JSON.stringify(routes, null, 2)}\n`);
  }
}

function main() {
  ensureDir(importDir);
  ensureDir(outputDir);

  const files = fs
    .readdirSync(importDir)
    .filter((name) => /\.(gpx|kml)$/i.test(name));

  if (files.length === 0) {
    console.log('No GPX/KML files found in data/import.');
    updateRoutesGeometryPaths();
    return;
  }

  const outputs = [];
  for (const fileName of files) {
    outputs.push(convertFile(fileName));
  }

  updateRoutesGeometryPaths();
  console.log(`Converted ${outputs.length} file(s):`);
  for (const out of outputs) console.log(`- ${path.relative(repoRoot, out)}`);
}

main();

