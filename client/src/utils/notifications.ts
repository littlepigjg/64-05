import type { Notification } from '../types';

/**
 * Merge two notification arrays by ID, deduplicating entries.
 *
 * The **server** array is authoritative for notifications that exist on
 * both sides (it carries the latest `read` status persisted on disk).
 * Notifications that only exist **locally** (received via WebSocket but
 * not yet present in a server history response — e.g. during the brief
 * window before persistence, or after a server restart) are preserved
 * so they never "flash" and disappear from the UI.
 *
 * The result is sorted by `createdAt` descending (newest first).
 */
export function mergeNotifications(
  local: Notification[],
  server: Notification[]
): Notification[] {
  const map = new Map<string, Notification>();

  // 1. Seed with local notifications first.
  for (const n of local) {
    map.set(n.id, { ...n });
  }

  // 2. Overlay server notifications — server wins for overlapping IDs
  //    (authoritative read status, title, etc.).
  for (const n of server) {
    map.set(n.id, { ...n });
  }

  // 3. Sort newest-first.
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Append `incoming` to `existing`, skipping duplicates by ID.
 * Used by the "load more" pagination path.
 */
export function appendUnique(
  existing: Notification[],
  incoming: Notification[]
): Notification[] {
  const existingIds = new Set(existing.map(n => n.id));
  const additions = incoming.filter(n => !existingIds.has(n.id));
  return [...existing, ...additions];
}
