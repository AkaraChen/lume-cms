import type { CompiledEntry } from './types.js';

export function isVisible(entry: CompiledEntry, nowMs: number): boolean {
  return !entry.draft && (entry.publishAtMs === null || entry.publishAtMs <= nowMs);
}
