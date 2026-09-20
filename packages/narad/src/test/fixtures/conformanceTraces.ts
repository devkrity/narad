import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
export const CONFORMANCE_DIR = join(dirname(require.resolve('@devkrity/narad-spec/package.json')), 'conformance');

export const POSITIVE_CONFORMANCE_TRACES = [
  'authority-replay.jsonl',
  'client-tool.jsonl',
  'client-tool-delivery-failure.jsonl',
  'client-tool-stop.jsonl',
  'independent-run.jsonl',
  'interrupt-pause.jsonl',
  'progress-replay.jsonl',
  'progress-while-paused.jsonl',
  'reconnect-revision.jsonl',
  'run-graph.jsonl',
  'snapshot-replay.jsonl',
  'terminal-usage.jsonl',
  'workflow.jsonl',
  'workspace-watch.jsonl',
] as const;

export const INVALID_CONFORMANCE_TRACES = [
  'graph-cursor-regress.invalid.jsonl',
  'graph-has-authority-fields.invalid.jsonl',
  'graph-unknown-root.invalid.jsonl',
  'progress-after-terminal.invalid.jsonl',
  'progress-before-run.invalid.jsonl',
  'progress-interrupt-adjacency.invalid.jsonl',
] as const;

/** Spec-invalid traces `pnpm spec:check` rejects. The headless reducer does not yet fail closed on these. */
export const SPEC_ONLY_INVALID_TRACES = [
  'graph-cursor-ahead.invalid.jsonl',
] as const;

export function readConformanceTrace(name: string): string[] {
  const content = readFileSync(join(CONFORMANCE_DIR, name), 'utf8');
  return content.split('\n').filter((line: string) => line.trim().length > 0);
}

export function listConformanceTraces(): string[] {
  return readdirSync(CONFORMANCE_DIR).filter((name: string) => name.endsWith('.jsonl'));
}

export function loadPositiveConformanceTraces(): Array<{ name: string; lines: string[] }> {
  return POSITIVE_CONFORMANCE_TRACES.map((name) => ({ name, lines: readConformanceTrace(name) }));
}

export function loadInvalidConformanceTraces(): Array<{ name: string; lines: string[] }> {
  return INVALID_CONFORMANCE_TRACES.map((name) => ({ name, lines: readConformanceTrace(name) }));
}
