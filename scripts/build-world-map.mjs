/**
 * Pravi statički SVG modul sa granicama država iz Natural Earth podataka.
 *
 * Pokreće se RUČNO i rezultat se commit-uje — dashboard nikad ne povlači mapu
 * sa interneta. CSP je `default-src 'self'`, a i cela poenta platforme je da
 * podaci ne odlaze trećoj strani, pa ni zahtev za pločicu mape ne sme da izađe.
 *
 *   node scripts/build-world-map.mjs
 *
 * Izvori (oba javno dostupna, Natural Earth je public domain):
 *   https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json
 *   https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, '.geotmp');
const OUT = path.join(root, 'packages', 'dashboard', 'lib', 'world-map.js');

const WIDTH = 1000;          // širina projektovanog platna
const LAT_CLAMP = 83;        // bez ovoga Antarktik i Grenland progutaju mapu
const PRECISION = 1;         // decimala u projektovanom prostoru (~0.1 px)
const MIN_AREA = 0.6;        // izbacuje sitna ostrva koja samo goje fajl

// ── TopoJSON dekodiranje ────────────────────────────────────────────────────
function decodeArcs(topology) {
  const { scale, translate } = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}

/** Negativan indeks znači isti arc, obrnutim redosledom. */
function arcPoints(arcs, index) {
  if (index >= 0) return arcs[index];
  return arcs[~index].slice().reverse();
}

function ringToPoints(arcs, ring) {
  const points = [];
  for (const idx of ring) {
    const seg = arcPoints(arcs, idx);
    // Krajnja tačka jednog arca je početna sledećeg - ne dupliramo je
    points.push(...(points.length ? seg.slice(1) : seg));
  }
  return points;
}

// ── Mercator ────────────────────────────────────────────────────────────────
function project([lon, lat]) {
  const clamped = Math.max(-LAT_CLAMP, Math.min(LAT_CLAMP, lat));
  const x = ((lon + 180) / 360) * WIDTH;
  const phi = (clamped * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  const y = (0.5 - merc / (2 * Math.PI)) * WIDTH;
  return [x, y];
}

const round = (n) => Number(n.toFixed(PRECISION));

/** Površina prstena u projektovanim jedinicama (za izbacivanje sitnih ostrva). */
function ringArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(area / 2);
}

function ringToPath(points) {
  const projected = points.map(project);
  if (ringArea(projected) < MIN_AREA) return '';

  const out = [];
  let prev = null;
  for (const p of projected) {
    const x = round(p[0]);
    const y = round(p[1]);
    // Preskoči tačke koje se posle zaokruživanja poklapaju
    if (prev && prev[0] === x && prev[1] === y) continue;
    out.push(out.length === 0 ? `M${x} ${y}` : `L${x} ${y}`);
    prev = [x, y];
  }
  return out.length > 2 ? `${out.join('')}Z` : '';
}

// ── Glavni deo ──────────────────────────────────────────────────────────────
const topology = JSON.parse(fs.readFileSync(path.join(tmp, 'countries-110m.json'), 'utf8'));
const isoList = JSON.parse(fs.readFileSync(path.join(tmp, 'iso.json'), 'utf8'));

const numericToAlpha2 = new Map(isoList.map((c) => [String(Number(c['country-code'])), c['alpha-2']]));
const alpha2ToName = new Map(isoList.map((c) => [c['alpha-2'], c.name]));
const alpha2ToRegion = new Map(isoList.map((c) => [c['alpha-2'], c.region || 'Other']));

const arcs = decodeArcs(topology);
const countries = {};
let skipped = 0;

for (const geom of topology.objects.countries.geometries) {
  const alpha2 = numericToAlpha2.get(String(Number(geom.id)));
  if (!alpha2) { skipped++; continue; }

  const polygons = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs;
  const parts = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const d = ringToPath(ringToPoints(arcs, ring));
      if (d) parts.push(d);
    }
  }
  if (parts.length) countries[alpha2] = parts.join('');
}

// Natural Earth vodi Kosovo kao zasebnu geometriju (id -99). Za ovog klijenta
// je ono deo Srbije, pa se putanja spaja sa RS i ne postoji kao posebna drzava.
// Isto grupisanje se primenjuje i na podatke, u config.countryMerge - inace bi
// mapa i tabele pokazivale razlicite brojeve.
const kosovo = topology.objects.countries.geometries.find((g) => g.properties?.name === 'Kosovo');
if (kosovo) {
  const polygons = kosovo.type === 'Polygon' ? [kosovo.arcs] : kosovo.arcs;
  const parts = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const d = ringToPath(ringToPoints(arcs, ring));
      if (d) parts.push(d);
    }
  }
  if (parts.length) countries.RS = (countries.RS ?? '') + parts.join('');
}

const names = {};
const regions = {};
for (const code of Object.keys(countries)) {
  names[code] = alpha2ToName.get(code) ?? code;
  regions[code] = alpha2ToRegion.get(code) ?? 'Other';
}

const [exLon, exLat] = [project([-180, LAT_CLAMP]), project([180, -LAT_CLAMP])];
const viewBox = `0 0 ${WIDTH} ${round(exLat[1] - exLon[1])}`;

// Isečak za Evropu: veći deo saobraćaja portala je tu, pa je to podrazumevani pogled
const euTopLeft = project([-12, 71]);
const euBottomRight = project([45, 34]);
const europeViewBox = [
  round(euTopLeft[0]),
  round(euTopLeft[1]),
  round(euBottomRight[0] - euTopLeft[0]),
  round(euBottomRight[1] - euTopLeft[1]),
].join(' ');

const body = `/**
 * Granice država kao SVG putanje — Mercator, širina platna ${WIDTH}.
 *
 * GENERISANO. Ne menjati ručno; pokrenuti \`node scripts/build-world-map.mjs\`.
 * Podaci: Natural Earth 110m (public domain) preko world-atlas.
 *
 * Mapa je ugrađena namerno: CSP dashboarda je \`default-src 'self'\`, pa se
 * pločice sa tuđeg servera ne bi ni učitale — a i ne želimo da posetioci
 * dashboarda odlaze trećoj strani.
 */

export const WORLD_VIEWBOX = ${JSON.stringify(viewBox)};
export const EUROPE_VIEWBOX = ${JSON.stringify(europeViewBox)};

/** Mercator projekcija identična onoj kojom su generisane putanje. */
export function projectLatLon(lat, lon) {
  const clamped = Math.max(-${LAT_CLAMP}, Math.min(${LAT_CLAMP}, Number(lat) || 0));
  const x = ((Number(lon) || 0) + 180) / 360 * ${WIDTH};
  const phi = (clamped * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  const y = (0.5 - merc / (2 * Math.PI)) * ${WIDTH};
  return { x, y };
}

export const COUNTRY_NAMES = ${JSON.stringify(names)};

export const COUNTRY_REGIONS = ${JSON.stringify(regions)};

export const COUNTRY_PATHS = ${JSON.stringify(countries)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`Zapisano ${OUT}`);
console.log(`  država sa putanjom : ${Object.keys(countries).length}`);
console.log(`  bez ISO koda       : ${skipped}`);
console.log(`  veličina modula    : ${kb} KB`);
console.log(`  world viewBox      : ${viewBox}`);
console.log(`  europe viewBox     : ${europeViewBox}`);
