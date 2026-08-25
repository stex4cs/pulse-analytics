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
 *   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson
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
const SUBDIVISION_MIN_STEP = 0.7;   // decimacija unutrasnjih granica
const SUBDIVISION_MIN_LENGTH = 2.5;  // ispod ovoga granica nestaje u sirini linije

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

/** Centroid poligona (ne prosek tacaka - to bi vukla gusto uzorkovana obala). */
function ringCentroid(points) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const f = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    cx += (points[j][0] + points[i][0]) * f;
    cy += (points[j][1] + points[i][1]) * f;
    a += f;
  }
  if (a === 0) return points[0];
  return [cx / (3 * a), cy / (3 * a)];
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
const shapes = new Map();   // alpha2 -> [{ centroid, area, bounds }]
let skipped = 0;

/** Pamti geometriju prstena da bi se posle izveli centroid i granice. */
function collect(code, projected) {
  const area = ringArea(projected);
  const xs = projected.map((p) => p[0]);
  const ys = projected.map((p) => p[1]);
  if (!shapes.has(code)) shapes.set(code, []);
  shapes.get(code).push({
    centroid: ringCentroid(projected),
    area,
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  });
}

for (const geom of topology.objects.countries.geometries) {
  const alpha2 = numericToAlpha2.get(String(Number(geom.id)));
  if (!alpha2) { skipped++; continue; }

  const polygons = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs;
  const parts = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const pts = ringToPoints(arcs, ring);
      const d = ringToPath(pts);
      if (d) {
        parts.push(d);
        collect(alpha2, pts.map(project));
      }
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
      const pts = ringToPoints(arcs, ring);
      const d = ringToPath(pts);
      if (d) {
        parts.push(d);
        collect('RS', pts.map(project));
      }
    }
  }
  if (parts.length) countries.RS = (countries.RS ?? '') + parts.join('');
}

/**
 * Kratka imena za natpise na mapi. ISO imena su za tabele; na mapi
 * "United Kingdom of Great Britain and Northern Ireland" ne staje nigde.
 */
const SHORT_NAMES = {
  GB: 'V. Britanija', US: 'SAD', RU: 'Rusija', DE: 'Nemačka', AT: 'Austrija',
  CH: 'Švajcarska', SE: 'Švedska', FR: 'Francuska', IT: 'Italija', ES: 'Španija',
  NL: 'Holandija', BE: 'Belgija', PL: 'Poljska', CZ: 'Češka', SK: 'Slovačka',
  HU: 'Mađarska', RO: 'Rumunija', BG: 'Bugarska', GR: 'Grčka', TR: 'Turska',
  RS: 'Srbija', HR: 'Hrvatska', BA: 'BiH', ME: 'Crna Gora', MK: 'S. Makedonija',
  SI: 'Slovenija', AL: 'Albanija', NO: 'Norveška', DK: 'Danska', FI: 'Finska',
  IE: 'Irska', PT: 'Portugal', UA: 'Ukrajina', BY: 'Belorusija', MD: 'Moldavija',
  CA: 'Kanada', AU: 'Australija', CN: 'Kina', JP: 'Japan', IN: 'Indija',
  BR: 'Brazil', AR: 'Argentina', ZA: 'JAR', EG: 'Egipat', AE: 'UAE',
  LT: 'Litvanija', LV: 'Letonija', EE: 'Estonija', LU: 'Luksemburg',
  CY: 'Kipar', MT: 'Malta', IS: 'Island', KR: 'J. Koreja', NZ: 'N. Zeland',
};

const names = {};
const shortNames = {};
const regions = {};
const centroids = {};
const bounds = {};

for (const code of Object.keys(countries)) {
  names[code] = alpha2ToName.get(code) ?? code;
  // Duga ISO imena se seku na prvom zarezu ili zagradi ("Korea (the Republic of)")
  shortNames[code] = SHORT_NAMES[code]
    ?? (alpha2ToName.get(code) ?? code).split(/[,(]/)[0].trim();
  regions[code] = alpha2ToRegion.get(code) ?? 'Other';

  const rings = shapes.get(code) ?? [];
  if (!rings.length) continue;

  // Natpis ide na najveci deo teritorije, ne na centar svih ostrva zajedno -
  // inace bi natpis za Norvesku zavrsio u moru.
  const biggest = rings.reduce((a, b) => (b.area > a.area ? b : a));
  centroids[code] = [round(biggest.centroid[0]), round(biggest.centroid[1])];
  bounds[code] = biggest.bounds.map(round);
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

// ── Unutrasnje granice (admin-1: savezne drzave, pokrajine, okruzi) ────────
// Bez njih Rusija, SAD, Brazil i Australija izgledaju kao prazne mrlje, a
// Srbija kao jedna siva mrlja bez okruga.
//
// Dva izvora, iz istog razloga kao kod gradova: region portala zasluzuje pun
// detalj, ostatak sveta samo grubi kontekst. Ceo 10m skup je 10.179 linija -
// neupotrebljivo veliko za pregledac.
const HOME_A3 = new Set(['SRB', 'BIH', 'HRV', 'MNE', 'MKD', 'SVN', 'ALB', 'KOS']);

const subdivisions = [];

/** Projektuje, decimira i pretvara liniju u SVG putanju. */
function lineToPath(coords, minStep, minLength) {
  const points = coords.map(project);
  if (points.length < 2) return '';

  const kept = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = kept[kept.length - 1];
    const dx = points[i][0] - last[0];
    const dy = points[i][1] - last[1];
    if (dx * dx + dy * dy >= minStep * minStep) kept.push(points[i]);
  }
  kept.push(points[points.length - 1]);
  if (kept.length < 2) return '';

  const first = kept[0];
  const last = kept[kept.length - 1];
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) < minLength && kept.length < 6) return '';

  const out = [];
  let prev = null;
  for (const pt of kept) {
    const x = round(pt[0]);
    const y = round(pt[1]);
    if (prev && prev[0] === x && prev[1] === y) continue;
    out.push(out.length === 0 ? `M${x} ${y}` : `L${x} ${y}`);
    prev = [x, y];
  }
  return out.length > 1 ? out.join('') : '';
}

function addLines(file, keep, minStep, minLength) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(tmp, file), 'utf8'));
  } catch {
    console.warn(`  (${file} nije nadjen - preskacem)`);
    return 0;
  }

  let added = 0;
  for (const feature of data.features) {
    if (!keep(feature.properties ?? {})) continue;
    const geoms = feature.geometry.type === 'MultiLineString'
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];
    for (const line of geoms) {
      const d = lineToPath(line, minStep, minLength);
      if (d) { subdivisions.push(d); added++; }
    }
  }
  return added;
}

const a3 = (props) => props.ADM0_A3 ?? props.adm0_a3 ?? '';

// Region: pun detalj iz 10m skupa
const homeLines = addLines(
  'admin1-10m.geojson',
  (props) => HOME_A3.has(a3(props)),
  0.12, 0.4,
);

// Ostatak sveta: grubi kontekst iz 50m skupa, jace decimiran
const worldLines = addLines(
  'admin1-lines.geojson',
  (props) => !HOME_A3.has(a3(props)) && Number(props.SCALERANK ?? 99) <= 5,
  0.7, 2.5,
);

const subdivisionsFile = path.join(path.dirname(OUT), 'world-subdivisions.js');
fs.writeFileSync(subdivisionsFile, `/**
 * Unutrasnje granice drzava (admin-1) kao SVG linije, ista Mercator projekcija
 * kao world-map.js.
 *
 * GENERISANO. Ne menjati rucno.
 * Podaci: Natural Earth admin-1 boundary lines (public domain) - 10m za region
 * portala, 50m za ostatak sveta.
 *
 * Ucitava se dinamicki, tek kad se mapa prikaze.
 */

export const SUBDIVISION_PATHS = ${JSON.stringify(subdivisions)};
`);

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

/** Kratka imena za natpise na mapi. Tabele koriste COUNTRY_NAMES. */
export const COUNTRY_SHORT = ${JSON.stringify(shortNames)};

export const COUNTRY_PATHS = ${JSON.stringify(countries)};

/** Tacka za natpis: centroid najveceg dela teritorije. */
export const COUNTRY_CENTROIDS = ${JSON.stringify(centroids)};

/** [x0, y0, x1, y1] najveceg dela - koristi se da se proceni ima li mesta za natpis. */
export const COUNTRY_BOUNDS = ${JSON.stringify(bounds)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`Zapisano ${OUT}`);
console.log(`  država sa putanjom : ${Object.keys(countries).length}`);
console.log(`  bez ISO koda       : ${skipped}`);
console.log(`  veličina modula    : ${kb} KB`);
console.log(`  sa centroidom      : ${Object.keys(centroids).length}`);
console.log(`  unutrasnje granice : ${subdivisions.length} (region ${homeLines}, svet ${worldLines}) = ${(fs.statSync(subdivisionsFile).size / 1024).toFixed(1)} KB`);
console.log(`  world viewBox      : ${viewBox}`);
console.log(`  europe viewBox     : ${europeViewBox}`);
