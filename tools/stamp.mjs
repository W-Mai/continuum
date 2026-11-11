// Stamp every module the page loads with a hash of its content.
//
// The site is served with long browser cache lifetimes (four hours for .js
// behind Cloudflare), and each ES module is cached on its own. After a release
// a browser can fetch the new index.html and still run last release's
// game.js, and the two do not fit together. So the import map in index.html
// lists every module of the page with ?v=<hash of its content>: a changed file
// gets a new URL and is fetched fresh, an unchanged one stays cached. The map
// also applies to imports made from inside modules, so nested modules are
// covered too. The car model gets the same treatment.
//
// There is still no build step: the page runs from source without this, it is
// only less safe to deploy.
//
// Usage: node tools/stamp.mjs           rewrite index.html
//        node tools/stamp.mjs --check   exit 1 if index.html is out of date

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const INDEX = join(ROOT, 'index.html');
const BARE = {
  three: 'tools/vendor/three.module.js',
};
const CAR = 'out/car.glb';

const hash = (file) => createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex').slice(0, 10);

// Static import and re-export specifiers in a module's source.
function specifiers(src) {
  const out = [];
  const re = /(?:^|[;\s])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function resolve(spec, fromFile) {
  if (BARE[spec]) return BARE[spec];
  if (spec.startsWith('three/addons/')) return 'tools/vendor/' + spec.slice('three/addons/'.length);
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return normalize(join(dirname(fromFile), spec)).replace(/\\/g, '/');
  }
  throw new Error(`cannot resolve '${spec}' imported from ${fromFile}`);
}

const html = readFileSync(INDEX, 'utf8');
const pageScripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!pageScripts.length) throw new Error('no module script in index.html');

// Walk the module graph from the page's own scripts.
const seen = new Set();
const queue = [];
for (const src of pageScripts) {
  for (const s of specifiers(src)) queue.push(resolve(s, 'index.html'));
}
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const src = readFileSync(join(ROOT, file), 'utf8');
  for (const s of specifiers(src)) queue.push(resolve(s, file));
}

const files = [...seen].sort();
const imports = {};
imports.three = './' + BARE.three + '?v=' + hash(BARE.three);
imports['three/addons/'] = './tools/vendor/';
for (const f of files) {
  if (f === BARE.three) continue;
  imports['./' + f] = './' + f + '?v=' + hash(f);
}
const map = JSON.stringify({ imports }, null, 2);

let next = html.replace(/<script type="importmap">[\s\S]*?<\/script>/,
  `<script type="importmap">\n${map}\n</script>`);
next = next.replace(/\.\/out\/car\.glb(\?v=[0-9a-f]+)?/g, `./${CAR}?v=${hash(CAR)}`);

if (process.argv.includes('--check')) {
  if (next !== html) {
    console.error('index.html is not stamped for the current sources: run node tools/stamp.mjs');
    process.exit(1);
  }
  console.log(`stamp OK: ${files.length} modules`);
} else {
  if (next !== html) writeFileSync(INDEX, next);
  console.log(`${next === html ? 'unchanged' : 'stamped'}: ${files.length} modules`);
  for (const f of files) console.log('  ' + relative('.', join(ROOT, f)) + '  ' + hash(f));
}
