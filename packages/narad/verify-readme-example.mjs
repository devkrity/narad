import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const readme = await readFile(resolve(packageRoot, '../../README.md'), 'utf8');
const replaySection = readme.match(/### Replay a trace\s+([\s\S]*?)(?=\n### |\n## |$)/);
assert.ok(replaySection, 'README must contain a "Replay a trace" section.');

const codeBlock = replaySection[1].match(/```ts\r?\n([\s\S]*?)\r?\n```/);
assert.ok(codeBlock, 'README replay section must contain a TypeScript code block.');

const temporaryDirectory = await mkdtemp(join(packageRoot, '.readme-replay-'));
try {
  const examplePath = join(temporaryDirectory, 'example.mjs');
  await writeFile(examplePath, codeBlock[1], 'utf8');

  const result = spawnSync(process.execPath, [examplePath], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, `README replay example exited with status ${result.status}.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('README replay example verified.');
