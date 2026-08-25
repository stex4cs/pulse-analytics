/**
 * Pravi statički modul sa gradovima za podlogu mape.
 *
 * Pokreće se RUČNO i rezultat se commit-uje — dashboard nikad ne povlači
 * geografiju sa interneta (CSP je `default-src 'self'`).
 *
 *   node scripts/build-places.mjs
 *
 * Izvor: GeoNames cities5000 (CC BY 4.0), https://download.geonames.org/export/dump/
 * Atribucija je obavezna i stoji ispod mape.
 *
 * ZAŠTO REGIONALNI PRAGOVI:
 * ovo je mapa za srpski sportski portal. Balkan zaslužuje gustinu kakvu ima
 * Google Maps, Bolivija ne. Pun skup je 69.653 grada — neupotrebljivo veliko
 * za pregledač, a 90% toga se nikad ne vidi na ovoj mapi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, '.geotmp', 'cities', 'cities5000.txt');
const OUT = path.join(root, 'packages', 'dashboard', 'lib', 'world-places.js');

const WIDTH = 1000;
const LAT_CLAMP = 83;

// Region portala: puna gustina
const HOME = new Set(['RS', 'BA', 'ME', 'HR', 'MK', 'SI', 'XK', 'AL']);
// Susedi i zemlje dijaspore: srednja gustina (dovoljno da se dijaspora locira)
const NEAR = new Set([
  'HU', 'RO', 'BG', 'GR', 'AT', 'DE', 'CH', 'IT', 'SE', 'FR', 'NL', 'BE',
  'CZ', 'SK', 'PL', 'DK', 'NO', 'GB', 'IE', 'ES', 'PT', 'TR', 'UA', 'RU',
  'US', 'CA', 'AU', 'LU', 'FI', 'EE', 'LV', 'LT', 'MD', 'BY', 'CY', 'MT',
]);

const minPopFor = (cc) => {
  if (HOME.has(cc)) return 5000;
  if (NEAR.has(cc)) return 90000;
  return 400000;
};

/**
 * Nivo detalja: 0 se vidi uvek, 4 tek na dubokom zumu.
 * Mapa bira prag prema nivou uvećanja.
 */
function tierFor(pop) {
  if (pop >= 1_000_000) return 0;
  if (pop >= 300_000) return 1;
  if (pop >= 100_000) return 2;
  if (pop >= 30_000) return 3;
  return 4;
}

function project(lon, lat) {
  const clamped = Math.max(-LAT_CLAMP, Math.min(LAT_CLAMP, lat));
  const x = ((lon + 180) / 360) * WIDTH;
  const phi = (clamped * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  const y = (0.5 - merc / (2 * Math.PI)) * WIDTH;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

const lines = fs.readFileSync(SRC, 'utf8').split('\n');
const places = [];
let scanned = 0;

for (const line of lines) {
  if (!line) continue;
  scanned++;
  const f = line.split('\t');
  const name = f[1];
  const lat = Number(f[4]);
  const lon = Number(f[5]);
  const cc = f[8];
  const pop = Number(f[14]) || 0;

  if (!name || !cc || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (pop < minPopFor(cc)) continue;

  const [x, y] = project(lon, lat);
  // [ime, x, y, nivo] — niz umesto objekta, tri puta manji modul
  places.push([name, x, y, tierFor(pop)]);
}

// Najveći prvi: mapa raspoređuje natpise pohlepno, pa red određuje prioritet
places.sort((a, b) => a[3] - b[3]);

const body = `/**
 * Gradovi za podlogu mape — ista Mercator projekcija kao world-map.js.
 *
 * GENERISANO. Ne menjati ručno; pokrenuti \`node scripts/build-places.mjs\`.
 * Izvor: GeoNames (CC BY 4.0) — atribucija stoji ispod mape.
 *
 * Format: [ime, x, y, nivo]. Nivo 0 se vidi uvek, 4 tek na dubokom zumu.
 * Učitava se dinamički, zajedno sa unutrašnjim granicama.
 */

export const PLACES = ${JSON.stringify(places)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);

const byTier = {};
for (const p of places) byTier[p[3]] = (byTier[p[3]] ?? 0) + 1;

console.log(`Zapisano ${OUT}`);
console.log(`  pregledano  : ${scanned}`);
console.log(`  zadržano    : ${places.length}`);
console.log(`  po nivoima  : ${Object.entries(byTier).map(([t, n]) => `n${t}:${n}`).join('  ')}`);
console.log(`  veličina    : ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
