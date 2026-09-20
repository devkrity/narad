import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const distPath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'index.js');

describe('production bundle hygiene', () => {
  it('does not import node built-ins', () => {
    const source = readFileSync(distPath, 'utf8');
    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toMatch(/require\(['"]node:/);
    expect(source).not.toMatch(/readFileSync|readdirSync|fileURLToPath/);
  });

  it('does not ship eval, dynamic import, or raw HTML helpers', () => {
    const source = readFileSync(distPath, 'utf8');
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new Function\s*\(/);
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
    expect(source).not.toMatch(/import\s*\(/);
  });
});
