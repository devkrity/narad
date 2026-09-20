export { NARAD_PROFILE_IDS, NARAD_PROTOCOL_VERSION, DEFAULT_NARAD_LIMITS } from './types.js';
export type * from './types.js';

export {
  NaradClientError,
  redactForPublicError,
  isSafeJsonPointer,
  assertWithinLimits,
  requireDottedLowercaseType,
  requireIsoDateTime,
  DOTTED_LOWERCASE_TYPE,
} from './security.js';
export { classifyWireRecord, resolveProfileForEventType } from './wire.js';
export { parseJsonPatchOperations, applySafeJsonPatch } from './jsonPatch.js';

export { validateWireRecord, validateAuthorityEvent } from './validate/index.js';
export { validateControlMessage } from './validate/control.js';
export { validateHydrateRecord } from './validate/hydrate.js';
export { validateCoreAuthorityEvent, validateCoreWatchEvent } from './validate/core.js';
export { validateProfileAuthorityEvent, assertProfileAllowed, allKnownProfileIds } from './validate/profile.js';

export { createNaradReducer, replayJsonlReducer } from './reducer/index.js';
export type { NaradReducer, CreateNaradReducerOptions } from './reducer/index.js';

export { createExternalStore, bindExternalStore } from './store/externalStore.js';
export { createSseFrameParser, parseSseFrameData, validateSseAuthorityFrameId } from './transport/sseParser.js';
export {
  createAttachCoordinator,
  mergeLiveAndBackfill,
  negotiateActiveProfiles,
  shouldBufferUntilBackfillComplete,
} from './session/attachCoordinator.js';
export { createCommandClient } from './session/commands.js';
export type { NaradCommandClient, NaradCommandResult, NaradCommandStatus } from './session/commands.js';
export { createClientExecutor } from './executor/clientExecutor.js';

export { createNaradClientStore } from './clientStore.js';
export type { NaradClientStore } from './clientStore.js';

export {
  installNaradClientDebugGlobal,
  isNaradClientDebugEnabled,
  logNaradApply,
  logNaradDebug,
  logNaradError,
  logNaradSse,
  logNaradSnapshot,
  setNaradClientDebugEnabled,
} from './debug.js';
export type { NaradDebugChannel } from './debug.js';
