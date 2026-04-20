/* historyStore — per-file undo/redo ring buffer.
 *
 * Keyed by a stable file identity (`fullPath` when loaded from a project,
 * `id` for offline/in-memory docs). Each entry is a pair of YAML snapshots
 * `{ before, after }` captured at the moment `workspaceStore.updateContent`
 * writes a new version. The "after" of entry N is the "before" of entry
 * N+1, so undo walks back one step, redo walks forward one step.
 *
 * Cap is per-file (50 entries) — the ring drops the oldest entry when the
 * cap is exceeded. Branching (i.e. making a new edit after undo) clears
 * the redo tail in the standard way.
 *
 * Design notes:
 *   - Snapshots are plain strings (the YAML text). No deep diffing: for
 *     the typical DataLex file (kilobytes) this is fine memory-wise and
 *     keeps the implementation trivially correct.
 *   - We skip entries where `before === after` (idempotent edits like
 *     typing and backspacing the same char) to avoid polluting the stack.
 *   - The pair shape (vs. flat snapshot list) lets the store apply the
 *     correct content when undoing/redoing across tab switches without
 *     having to remember the pre-mutation content separately.
 */
import { create } from "zustand";

const MAX_ENTRIES = 50;

function emptyStack() {
  return { past: [], future: [] };
}

const useHistoryStore = create((set, get) => ({
  // Map<fileKey, { past: Array<{before,after}>, future: Array<{before,after}> }>
  stacks: new Map(),

  /* Record a mutation. `before` and `after` are YAML strings. Idempotent
   * edits (before === after) are dropped. A new mutation always clears
   * the redo tail. */
  push: (fileKey, before, after) => {
    if (!fileKey) return;
    if (before === after) return;
    const stacks = new Map(get().stacks);
    const cur = stacks.get(fileKey) || emptyStack();
    const past = cur.past.concat([{ before, after }]);
    // Enforce cap by dropping from the head.
    const trimmed = past.length > MAX_ENTRIES ? past.slice(past.length - MAX_ENTRIES) : past;
    stacks.set(fileKey, { past: trimmed, future: [] });
    set({ stacks });
  },

  /* Pop one entry off the past stack and return its `before` snapshot.
   * The entry moves to the future stack so redo can replay it. Returns
   * null when the past is empty. */
  undo: (fileKey) => {
    if (!fileKey) return null;
    const stacks = new Map(get().stacks);
    const cur = stacks.get(fileKey);
    if (!cur || cur.past.length === 0) return null;
    const past = cur.past.slice();
    const entry = past.pop();
    const future = [entry].concat(cur.future);
    stacks.set(fileKey, { past, future });
    set({ stacks });
    return entry.before;
  },

  /* Pop one entry off the future stack and return its `after` snapshot.
   * The entry moves back onto the past stack. Returns null when the
   * future is empty. */
  redo: (fileKey) => {
    if (!fileKey) return null;
    const stacks = new Map(get().stacks);
    const cur = stacks.get(fileKey);
    if (!cur || cur.future.length === 0) return null;
    const future = cur.future.slice();
    const entry = future.shift();
    const past = cur.past.concat([entry]);
    stacks.set(fileKey, { past, future });
    set({ stacks });
    return entry.after;
  },

  /* Cheap introspection for the Chrome Undo/Redo button enabled state. */
  canUndo: (fileKey) => {
    if (!fileKey) return false;
    const cur = get().stacks.get(fileKey);
    return !!(cur && cur.past.length > 0);
  },
  canRedo: (fileKey) => {
    if (!fileKey) return false;
    const cur = get().stacks.get(fileKey);
    return !!(cur && cur.future.length > 0);
  },

  /* Clear the stack for a single file (e.g. after an explicit "revert" or
   * when a file is closed). Omitting `fileKey` clears everything. */
  clear: (fileKey) => {
    if (!fileKey) {
      set({ stacks: new Map() });
      return;
    }
    const stacks = new Map(get().stacks);
    stacks.delete(fileKey);
    set({ stacks });
  },
}));

/* Stable file identity for use as the stacks-map key. Prefers `fullPath`
 * (disk-backed files) then `id` (offline in-memory docs). Returns an
 * empty string when no active file — callers should treat that as "no
 * history available". */
export function fileKeyOf(activeFile) {
  if (!activeFile) return "";
  return String(activeFile.fullPath || activeFile.id || activeFile.name || "");
}

export default useHistoryStore;
