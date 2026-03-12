import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const osmDir = path.join(repoRoot, 'data', 'import', 'osm');
const geoDir = path.join(repoRoot, 'public', 'geo');
const routesPath = path.join(repoRoot, 'data', 'routes.json');

const SANTIAGO = [-8.5448, 42.8782];
const ASTORGA = [-6.056, 42.458];
const MELIDE = [-8.014, 42.913];

const TARGETS = [
  {
    variantId: 'camino-portugues-main',
    relationId: 7684546,
    extraRelationIds: [385135],
    outFile: 'camino-portugues.geojson'
  },
  { variantId: 'camino-del-norte-main', relationId: 19001007, outFile: 'camino-del-norte.geojson' },
  { variantId: 'camino-primitivo-main', relationId: 19298101, outFile: 'camino-primitivo.geojson' },
  { variantId: 'via-de-la-plata-main', relationId: 241329, outFile: 'via-de-la-plata.geojson' },
  { variantId: 'camino-ingles-main', relationId: 1102966, outFile: 'camino-ingles.geojson' },
  { variantId: 'camino-finisterre-main', relationId: 385098, outFile: 'camino-finisterre.geojson' }
];

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1]] = m[2];
  return attrs;
}

function parseOsmXml(xml, graph) {
  const nodeRe = /<node\b([^>]*?)\/>/g;
  let m;
  while ((m = nodeRe.exec(xml))) {
    const a = parseAttrs(m[1]);
    if (!a.id || !a.lon || !a.lat) continue;
    if (!graph.nodes.has(a.id)) graph.nodes.set(a.id, [Number(a.lon), Number(a.lat)]);
  }

  const wayRe = /<way\b([^>]*?)>([\s\S]*?)<\/way>/g;
  while ((m = wayRe.exec(xml))) {
    const wayAttrs = parseAttrs(m[1]);
    if (!wayAttrs.id || graph.ways.has(wayAttrs.id)) continue;
    const ndRefs = [];
    const ndRe = /<nd\b([^>]*?)\/>/g;
    let ndMatch;
    while ((ndMatch = ndRe.exec(m[2]))) {
      const ndAttrs = parseAttrs(ndMatch[1]);
      if (ndAttrs.ref) ndRefs.push(ndAttrs.ref);
    }
    graph.ways.set(wayAttrs.id, ndRefs);
  }

  const relRe = /<relation\b([^>]*?)>([\s\S]*?)<\/relation>/g;
  while ((m = relRe.exec(xml))) {
    const relAttrs = parseAttrs(m[1]);
    if (!relAttrs.id || graph.relations.has(relAttrs.id)) continue;
    const members = [];
    const memberRe = /<member\b([^>]*?)\/>/g;
    let memberMatch;
    while ((memberMatch = memberRe.exec(m[2]))) {
      const memberAttrs = parseAttrs(memberMatch[1]);
      if (!memberAttrs.type || !memberAttrs.ref) continue;
      members.push({
        type: memberAttrs.type,
        ref: memberAttrs.ref,
        role: memberAttrs.role ?? ''
      });
    }
    graph.relations.set(relAttrs.id, members);
  }
}

function loadGraph() {
  const graph = {
    nodes: new Map(),
    ways: new Map(),
    relations: new Map()
  };

  const files = fs.readdirSync(osmDir).filter((f) => f.endsWith('.osm.xml'));
  for (const file of files) {
    const xml = fs.readFileSync(path.join(osmDir, file), 'utf8');
    parseOsmXml(xml, graph);
  }
  return graph;
}

function shouldSkipMemberRole(role) {
  return /(alternat|variant|link|spur|excursion|detour|shortcut)/i.test(role);
}

function flattenWaysByRelation(relId, graph, visited = new Set()) {
  if (visited.has(relId)) return [];
  visited.add(relId);

  const members = graph.relations.get(String(relId)) ?? [];
  const ways = [];
  for (const member of members) {
    if (shouldSkipMemberRole(member.role)) continue;
    if (member.type === 'way') {
      ways.push(member.ref);
      continue;
    }
    if (member.type === 'relation') {
      ways.push(...flattenWaysByRelation(member.ref, graph, visited));
    }
  }
  return ways;
}

function sqDist(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function orientCoords(prevEnd, coords) {
  const start = coords[0];
  const end = coords[coords.length - 1];
  return sqDist(prevEnd, start) <= sqDist(prevEnd, end) ? coords : [...coords].reverse();
}

function wayToCoords(wayId, graph) {
  const refs = graph.ways.get(String(wayId));
  if (!refs || refs.length < 2) return null;
  const coords = [];
  for (const ref of refs) {
    const pt = graph.nodes.get(String(ref));
    if (!pt) continue;
    coords.push(pt);
  }
  return coords.length > 1 ? coords : null;
}

function dedupeSequential(points) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1];
    const curr = points[i];
    if (prev[0] === curr[0] && prev[1] === curr[1]) continue;
    out.push(curr);
  }
  return out;
}

function sanitizeSegments(segments) {
  const minLon = -10.8;
  const maxLon = -1.0;
  const minLat = 36.5;
  const maxLat = 44.5;
  const maxJumpSq = 0.35 * 0.35;
  const cleaned = [];

  for (const seg of segments) {
    let current = [];
    for (const pt of seg) {
      const [lon, lat] = pt;
      const inIberia = lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
      if (!inIberia) {
        if (current.length > 1) cleaned.push(dedupeSequential(current));
        current = [];
        continue;
      }
      if (current.length > 0 && sqDist(current[current.length - 1], pt) > maxJumpSq) {
        if (current.length > 1) cleaned.push(dedupeSequential(current));
        current = [pt];
        continue;
      }
      current.push(pt);
    }
    if (current.length > 1) cleaned.push(dedupeSequential(current));
  }
  return cleaned.filter((seg) => seg.length > 1);
}

function buildSegments(wayIds, graph) {
  const segments = [];
  let current = [];
  const maxJoinSq = 0.03 * 0.03;

  for (const wayId of wayIds) {
    const coords = wayToCoords(wayId, graph);
    if (!coords) continue;

    if (current.length === 0) {
      current = coords.slice();
      continue;
    }

    const oriented = orientCoords(current[current.length - 1], coords);
    const gapSq = sqDist(current[current.length - 1], oriented[0]);
    if (gapSq <= maxJoinSq) {
      current.push(...oriented.slice(1));
      continue;
    }

    current = dedupeSequential(current);
    if (current.length > 1) segments.push(current);
    current = coords.slice();
  }

  current = dedupeSequential(current);
  if (current.length > 1) segments.push(current);
  return sanitizeSegments(segments);
}

function flattenGeoLine(geometry) {
  if (geometry.type === 'LineString') return geometry.coordinates.slice();
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat();
  return [];
}

function nearestIndex(line, target) {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length; i += 1) {
    const d = sqDist(line[i], target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function sliceFrenchTail(startPoint) {
  const frenchRaw = JSON.parse(fs.readFileSync(path.join(geoDir, 'camino-frances-full.geojson'), 'utf8'));
  const frenchFeature = frenchRaw.features?.[0];
  if (!frenchFeature?.geometry) return [];
  const line = flattenGeoLine(frenchFeature.geometry);
  if (line.length < 2) return [];

  const startIndex = nearestIndex(line, startPoint);
  const endIndex = nearestIndex(line, SANTIAGO);
  if (startIndex === endIndex) return [];
  if (startIndex < endIndex) return line.slice(startIndex, endIndex + 1);
  return line.slice(endIndex, startIndex + 1).reverse();
}

function attachTail(segments, tail) {
  if (!tail.length) return segments;
  if (!segments.length) return [tail];

  let bestSeg = 0;
  let bestAtEnd = true;
  let bestReverse = false;
  let best = Number.POSITIVE_INFINITY;

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const dEndStart = sqDist(seg[seg.length - 1], tail[0]);
    if (dEndStart < best) {
      best = dEndStart;
      bestSeg = i;
      bestAtEnd = true;
      bestReverse = false;
    }
    const dEndEnd = sqDist(seg[seg.length - 1], tail[tail.length - 1]);
    if (dEndEnd < best) {
      best = dEndEnd;
      bestSeg = i;
      bestAtEnd = true;
      bestReverse = true;
    }
    const dStartStart = sqDist(seg[0], tail[0]);
    if (dStartStart < best) {
      best = dStartStart;
      bestSeg = i;
      bestAtEnd = false;
      bestReverse = true;
    }
    const dStartEnd = sqDist(seg[0], tail[tail.length - 1]);
    if (dStartEnd < best) {
      best = dStartEnd;
      bestSeg = i;
      bestAtEnd = false;
      bestReverse = false;
    }
  }

  const tailOriented = bestReverse ? [...tail].reverse() : tail;
  const seg = segments[bestSeg];
  if (bestAtEnd) {
    seg.push(...tailOriented.slice(1));
  } else {
    seg.unshift(...tailOriented.slice(0, -1));
  }
  return segments;
}

function toFeatureCollection(name, source, segments) {
  const valid = segments
    .map((seg) => dedupeSequential(seg))
    .filter((seg) => seg.length > 1);

  const geometry =
    valid.length === 1
      ? { type: 'LineString', coordinates: valid[0] }
      : { type: 'MultiLineString', coordinates: valid };

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name,
          source
        },
        geometry
      }
    ]
  };
}

function routeHasSantiago(segments) {
  return segments.some((seg) => seg.some((pt) => sqDist(pt, SANTIAGO) < 0.02 * 0.02));
}

function nearestPointToTarget(segments, target) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const seg of segments) {
    for (const pt of seg) {
      const d = sqDist(pt, target);
      if (d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
  }
  return best ?? target;
}

function main() {
  const graph = loadGraph();
  const outputs = [];

  for (const target of TARGETS) {
    const relationIds = [target.relationId, ...(target.extraRelationIds ?? [])];
    const wayIds = relationIds.flatMap((id) => flattenWaysByRelation(id, graph));
    let segments = buildSegments(wayIds, graph);

    if (target.variantId === 'via-de-la-plata-main') {
      segments = attachTail(segments, sliceFrenchTail(ASTORGA));
    } else if (target.variantId === 'camino-primitivo-main') {
      segments = attachTail(segments, sliceFrenchTail(MELIDE));
    }

    if (
      ['camino-portugues-main', 'camino-del-norte-main', 'camino-primitivo-main', 'via-de-la-plata-main', 'camino-ingles-main'].includes(
        target.variantId
      ) &&
      !routeHasSantiago(segments)
    ) {
      const nearest = nearestPointToTarget(segments, SANTIAGO);
      segments = attachTail(segments, sliceFrenchTail(nearest));
    }

    const sourceRelText = relationIds.join('+');
    const fc = toFeatureCollection(target.variantId, `openstreetmap_relation_${sourceRelText}`, segments);
    const outputPath = path.join(geoDir, target.outFile);
    fs.writeFileSync(outputPath, `${JSON.stringify(fc)}\n`);
    outputs.push({ ...target, outputPath, segments: segments.length, points: segments.reduce((n, s) => n + s.length, 0) });
  }

  const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
  const sourceByVariant = Object.fromEntries(
    TARGETS.map((t) => {
      const rels = [t.relationId, ...(t.extraRelationIds ?? [])].join('+');
      return [t.variantId, `osm_relation_${rels}_imported_2026-03-07`];
    })
  );
  for (const variant of routes.routeVariants ?? []) {
    if (sourceByVariant[variant.id]) {
      variant.geometry_source = sourceByVariant[variant.id];
    }
  }
  fs.writeFileSync(routesPath, `${JSON.stringify(routes, null, 2)}\n`);

  for (const row of outputs) {
    console.log(
      `${row.variantId}: ${path.relative(repoRoot, row.outputPath)} (${row.points} pts across ${row.segments} segment(s), relation ${row.relationId}${
        row.extraRelationIds?.length ? `+${row.extraRelationIds.join('+')}` : ''
      })`
    );
  }
}

main();
