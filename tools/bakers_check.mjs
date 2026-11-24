// The bake workers can load all they import.
//
// A worker cannot use the page's import map, so the page hands it the URL of
// each module the bakery needs, by name (MODULES in src/render/bakers.js), and
// the worker loads them from blobs (src/world/bakeworker.js). A module that one
// of them imports and that is not in that list stops the worker at its start
// ("no URL for ..."): the page then bakes every land and forest tile, the
// ground's maps, the leaves and the road's grain itself, and the first frame
// waits seconds longer for them, with nothing on the screen to say so.
//
// In node, without a browser: the modules the worker imports, and all that
// they import, are read from their sources and held to MODULES (each of them
// in it; none in it that nothing imports).
//
// Usage: node tools/bakers_check.mjs [--root DIR]     (DIR: another checkout)

import { existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const ROOT = (argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : new URL('..', import.meta.url).pathname).replace(/\/?$/, '/');
const read = (p) => readFileSync(ROOT + p, 'utf8');

// The same pattern the worker rewrites the imports by (bakeworker.js, SPEC).
const SPEC = /((?:^|[;\s])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?)(['"])([^'"]+)\2/g;
// Comments out, so that a module named in one is not taken for an import.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const listed = /const MODULES = \[([^\]]*)\]/.exec(read('src/render/bakers.js'));
const worker = read('src/world/bakeworker.js');
const entries = /\[((?:\s*'[\w]+\.js',?)+)\s*\]\.map\(\(n\) => import\(blobs\[n\]\)\)/.exec(worker);
const problems = [];
if (!listed) problems.push('src/render/bakers.js: no MODULES list');
if (!entries) problems.push('src/world/bakeworker.js: no list of the modules it imports');

if (!problems.length) {
  const modules = new Set([...listed[1].matchAll(/'([\w]+)'/g)].map((m) => m[1] + '.js'));
  const roots = [...entries[1].matchAll(/'([\w]+\.js)'/g)].map((m) => m[1]);
  const seen = new Map();    // module -> the one that imports it first
  const walk = (name, from) => {
    if (seen.has(name)) return;
    seen.set(name, from);
    const path = `src/world/${name}`;
    if (!existsSync(ROOT + path)) {
      problems.push(`${from} imports ${name}, which is not in src/world`);
      return;
    }
    for (const m of code(read(path)).matchAll(SPEC)) {
      const spec = m[3];
      if (!spec.startsWith('./')) problems.push(`${name} imports ${spec}: a worker can only load siblings`);
      else walk(spec.slice(2), name);
    }
  };
  for (const r of roots) walk(r, 'bakeworker.js');
  for (const [name, from] of seen) {
    if (!modules.has(name)) problems.push(`${name} (imported by ${from}) is not in MODULES: the workers cannot start`);
  }
  for (const name of modules) {
    if (!seen.has(name)) problems.push(`${name} is in MODULES and nothing the workers load imports it`);
  }
  console.log(`bakers: the workers load ${seen.size} modules from ${roots.length}, ${modules.size} in MODULES`);
}

for (const p of problems) console.log('  FAIL ' + p);
console.log(problems.length ? `bakers: ${problems.length} problem(s)` : 'bakers: OK');
process.exit(problems.length ? 1 : 0);
