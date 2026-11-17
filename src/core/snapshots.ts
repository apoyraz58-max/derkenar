/**
 * Restore points: once a day (and before a restore) the whole library is
 * kept, compressed, in the add-in's storage; the last seven days stay.
 * A restore brings the library back to that day without losing anything:
 * works added since go to the trash, where they can still be taken back.
 */
import type { LibraryCopy } from "./librarycopy.js";
import type { SavedSearch } from "./searchquery.js";
import type { Collection, Item } from "./zotero.js";

export interface Snapshot {
  /** When it was taken (ISO). */
  readonly saved: string;
  /** Works (not in the trash) at the time. */
  readonly count: number;
  /** "daily", "manual" or "before-restore". */
  readonly reason: string;
  /** packLibrary() output. */
  readonly packed: string;
}

export const KEEP_DAYS = 7;

const day = (iso: string) => iso.slice(0, 10);

/** Is a daily snapshot due (none taken today)? */
export function snapshotDue(list: readonly Snapshot[], now = new Date()): boolean {
  return !list.some((s) => s.reason === "daily" && day(s.saved) === day(now.toISOString()));
}

/** Newest first; one daily per day for the last KEEP_DAYS days, and the last three others (manual, before a restore). */
export function pruneSnapshots(list: readonly Snapshot[]): Snapshot[] {
  const sorted = [...list].sort((a, b) => b.saved.localeCompare(a.saved));
  const days = new Set<string>();
  const daily = sorted.filter((s) => s.reason === "daily" && !days.has(day(s.saved)) && days.add(day(s.saved)) && days.size <= KEEP_DAYS);
  const other = sorted.filter((s) => s.reason !== "daily").slice(0, 3);
  return [...daily, ...other].sort((a, b) => b.saved.localeCompare(a.saved));
}

/** What to write to go back to a snapshot: its records as they were, and later works trashed. */
export function restorePlan(current: { items: readonly Item[] }, snap: LibraryCopy, at: string): { items: Item[]; collections: Collection[]; searches: SavedSearch[]; trashed: number } {
  const inSnap = new Set(snap.items.map((i) => i.key));
  const later = current.items.filter((i) => !inSnap.has(i.key) && !i.deleted).map((i) => ({ ...i, deleted: true, dateModified: at }));
  return { items: [...snap.items, ...later], collections: snap.collections, searches: snap.searches, trashed: later.length };
}
