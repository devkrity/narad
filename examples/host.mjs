import { createServer } from 'node:http';

const records = [
  { type: 'workflow.started', protocolVersion: 'narad/v1', eventId: 'evt-1', timestamp: '2026-01-01T00:00:00Z', sessionId: 'example-session', sessionSequence: 1, workflowId: 'example-workflow', workflowSequence: 1, defaultClientExecutorId: 'example-client' },
  { type: 'run.started', protocolVersion: 'narad/v1', eventId: 'evt-2', timestamp: '2026-01-01T00:00:01Z', sessionId: 'example-session', sessionSequence: 2, workflowId: 'example-workflow', workflowSequence: 2, rootRunId: 'example-run', runId: 'example-run', sequence: 1, clientExecutorId: 'example-client' },
  { type: 'run.finished', protocolVersion: 'narad/v1', eventId: 'evt-3', timestamp: '2026-01-01T00:00:02Z', sessionId: 'example-session', sessionSequence: 3, workflowId: 'example-workflow', workflowSequence: 3, rootRunId: 'example-run', runId: 'example-run', sequence: 2 },
];

createServer((request, response) => {
  if (request.url !== '/events') { response.writeHead(404).end('Use /events'); return; }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  records.forEach((record) => response.write(`id: ${record.eventId}\nevent: ${record.type}\ndata: ${JSON.stringify(record)}\n\n`));
  response.end();
}).listen(8787, '127.0.0.1', () => console.log('Narad example host: http://127.0.0.1:8787/events'));
