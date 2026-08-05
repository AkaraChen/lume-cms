import 'server-only';

import type { CompiledContent, CompiledEntry } from './types.js';

/**
 * Returns unpublished content. Use only in an authenticated server-side preview route.
 * @internal
 */
export function unsafe_getAllEntriesIncludingUnpublished(
  content: CompiledContent,
): readonly CompiledEntry[] {
  return deepFreeze(structuredClone(content.entries));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
