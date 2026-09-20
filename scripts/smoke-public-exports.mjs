#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../packages');

const exportsToSmoke = [
  {
    name: '@devkrity/narad',
    importPath: resolve(packagesRoot, 'narad/dist/index.js'),
    assert: (mod) => {
      if (typeof mod.createNaradReducer !== 'function') {
        throw new Error('createNaradReducer missing');
      }
      if (typeof mod.createNaradClientStore !== 'function') {
        throw new Error('createNaradClientStore missing');
      }
      if (typeof mod.createClientExecutor !== 'function') {
        throw new Error('createClientExecutor missing');
      }
    },
  },
  {
    name: '@devkrity/narad-react',
    importPath: resolve(packagesRoot, 'narad-react/dist/index.js'),
    assert: (mod) => {
      if (typeof mod.NaradProvider !== 'function') {
        throw new Error('NaradProvider missing');
      }
      if (typeof mod.useNaradClientStore !== 'function') {
        throw new Error('useNaradClientStore missing');
      }
      if (typeof mod.useNaradSnapshot !== 'function') {
        throw new Error('useNaradSnapshot missing');
      }
      if (typeof mod.useNaradSelector !== 'function') {
        throw new Error('useNaradSelector missing');
      }
    },
  },
];

let failed = 0;

for (const entry of exportsToSmoke) {
  try {
    const mod = await import(pathToFileURL(entry.importPath).href);
    entry.assert(mod);
    console.log(`✓ ${entry.name} dist import OK`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${entry.name} dist import FAILED`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
  console.error(`\n${failed} public export smoke test(s) failed.`);
} else {
  console.log(`\nAll ${exportsToSmoke.length} public dist exports smoke-tested successfully.`);
}
