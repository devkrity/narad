import { readConformanceTrace } from './fixtures/conformanceTraces.js';

/** Machine-independent Narad release-gate corpora sizes (recorded in docs/development/narad-release-gates.md). */
export const RELEASE_GATE_CORPUS = {
  steadyStateEvents: 5_000,
  syntheticAuthorityEvents: 2_000,
  gapBackfillEvents: 500,
  dedupOverflowEvents: 200,
  reactNotificationEvents: 120,
} as const;

export function progressEvent(
  sessionId: string,
  rootRunId: string,
  sessionSequence: number,
): Record<string, unknown> {
  return {
    type: 'progress.recorded',
    protocolVersion: 'narad/v1',
    eventId: `evt-${sessionSequence}`,
    timestamp: '2026-08-05T00:00:00Z',
    sessionId,
    sessionSequence,
    rootRunId,
    runId: rootRunId,
    sequence: sessionSequence,
    progressId: `progress-${sessionSequence}`,
    category: 'phase',
    label: `Step ${sessionSequence}`,
    status: 'active',
    privacy: 'public',
  };
}

export function runStartedEvent(
  sessionId: string,
  rootRunId: string,
  sessionSequence = 1,
): Record<string, unknown> {
  return {
    type: 'run.started',
    protocolVersion: 'narad/v1',
    eventId: `evt-${sessionSequence}`,
    timestamp: '2026-08-05T00:00:00Z',
    sessionId,
    sessionSequence,
    rootRunId,
    runId: rootRunId,
    sequence: 1,
  };
}

export function buildSteadyStateCorpus(sessionId: string, rootRunId: string, count: number): unknown[] {
  const events: unknown[] = [runStartedEvent(sessionId, rootRunId)];
  for (let index = 2; index <= count; index += 1) {
    events.push(progressEvent(sessionId, rootRunId, index));
  }
  return events;
}

export function loadAuthorityReplayCorpus(): unknown[] {
  const lines = readConformanceTrace('authority-replay.jsonl');
  return lines.map((line) => JSON.parse(line) as unknown);
}

export function loadGraphProgressCorpus(): unknown[] {
  const graph = readConformanceTrace('run-graph.jsonl').map((line) => JSON.parse(line) as unknown);
  const progress = readConformanceTrace('progress-replay.jsonl').map((line) => JSON.parse(line) as unknown);
  return [...graph, ...progress];
}

export function measureMedianMs(runs: number[], iterations: number, fn: () => void): number {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)] ?? runs[0] ?? 0;
}
