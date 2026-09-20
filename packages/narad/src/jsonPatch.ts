import type { Operation } from 'fast-json-patch';
import { applyPatch, deepClone } from 'fast-json-patch';
import { NaradClientError, isSafeJsonPointer } from './security.js';

export type JsonPatchOperation = Readonly<{
  op: string;
  path: string;
  value?: unknown;
  from?: string;
}>;

const ALLOWED_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

export function parseJsonPatchOperations(value: unknown): JsonPatchOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NaradClientError('invalid_patch', 'Patch must be a non-empty array.');
  }

  const operations: JsonPatchOperation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new NaradClientError('invalid_patch', 'Patch operation must be an object.');
    }
    const operation = item as Record<string, unknown>;
    if (typeof operation.op !== 'string' || typeof operation.path !== 'string') {
      throw new NaradClientError('invalid_patch', 'Patch operation requires op and path.');
    }
    if (!ALLOWED_OPS.has(operation.op)) {
      throw new NaradClientError('invalid_patch', 'Unsupported patch operation.');
    }
    if (!isSafeJsonPointer(operation.path)) {
      throw new NaradClientError('unsafe_patch_path', 'Patch path is not allowed.');
    }
    if (typeof operation.from === 'string' && !isSafeJsonPointer(operation.from)) {
      throw new NaradClientError('unsafe_patch_path', 'Patch from path is not allowed.');
    }
    operations.push({
      op: operation.op,
      path: operation.path,
      value: operation.value,
      from: typeof operation.from === 'string' ? operation.from : undefined,
    });
  }

  return operations;
}

export function applySafeJsonPatch<T>(document: T, patch: readonly JsonPatchOperation[]): T {
  const cloned = deepClone(document) as T;
  try {
    // mutateDocument must be true: with false, applyPatch leaves `cloned` unchanged and only
    // returns the result on PatchResult.newDocument — which we discarded. Graph status deltas
    // then advanced revision without updating nodes ("Graph hydrate rejected" / stale UI).
    applyPatch(cloned as object, patch as Operation[], /* validateOperation */ true, /* mutateDocument */ true);
  } catch (error) {
    const detail = error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Graph patch application failed.';
    throw new NaradClientError('invalid_patch', detail);
  }
  return cloned;
}
