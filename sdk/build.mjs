/**
 * Build za pulse.js: minifikacija + provera budzeta od 5KB gzipped (sekcija 3.1).
 * Build pada ako se budzet prekoraci - inace se limit tiho izgubi.
 */
import esbuild from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const BUDGET_GZIP = 5 * 1024;
const outDir = path.join(import.meta.dirname, 'dist');
fs.mkdirSync(outDir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(import.meta.dirname, 'src', 'pulse.js')],
  outfile: path.join(outDir, 'pulse.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2018'],
  legalComments: 'none',
  write: true,
});

if (result.errors.length) {
  console.error(result.errors);
  process.exit(1);
}

const code = fs.readFileSync(path.join(outDir, 'pulse.js'));
const gzip = gzipSync(code, { level: 9 }).length;
const brotli = brotliCompressSync(code).length;

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

console.log('pulse.js');
console.log(`  minified : ${kb(code.length)}`);
console.log(`  gzip     : ${kb(gzip)}  (budžet ${kb(BUDGET_GZIP)})`);
console.log(`  brotli   : ${kb(brotli)}`);

if (gzip > BUDGET_GZIP) {
  console.error(`\nBUDŽET PREKORAČEN: ${kb(gzip)} > ${kb(BUDGET_GZIP)}`);
  process.exit(1);
}
console.log('\nOK — SDK je u budžetu.');
