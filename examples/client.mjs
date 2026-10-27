import { DEFAULT_NARAD_LIMITS, createSseFrameParser, parseSseFrameData, validateAuthorityEvent, validateSseAuthorityFrameId } from '../packages/narad/dist/index.js';

const response = await fetch('http://127.0.0.1:8787/events');
if (!response.ok || !response.body) throw new Error(`Host request failed: ${response.status}`);
const parser = createSseFrameParser();
const reader = response.body.getReader();
const decoder = new TextDecoder();
let count = 0;
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
    const record = parseSseFrameData(frame);
    validateSseAuthorityFrameId(frame, record);
    validateAuthorityEvent(record, DEFAULT_NARAD_LIMITS, ['narad.workflow/v1']);
    console.log(`${frame.id}: ${record.type}`);
    count += 1;
  }
}
if (count !== 3) throw new Error(`Expected 3 authority events, received ${count}`);
console.log('All host events parsed and validated.');
