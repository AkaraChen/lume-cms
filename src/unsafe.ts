import 'server-only';

import type { CompiledContent, CompiledEntry } from './types.js';

/**
 * Returns unpublished content. Use only in an authenticated server-side preview route.
 * @internal
 */
export function unsafe_getAllEntriesIncludingUnpublished(
  content: CompiledContent,
): readonly CompiledEntry[] {
  return content.entries;
}
