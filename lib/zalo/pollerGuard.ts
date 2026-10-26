import fs from "node:fs";

// What the poller must remember ACROSS its own crashes.
//
// The cursor in zalo_watch_config is only written at the end of a cycle, so a process that
// dies in the middle (the kernel's OOM killer, a deploy) comes back and reads the same
// messages again. Two things must not repeat then:
//   - the files posted into the group for a PDF message (an Excel + a PDF each time), and
//   - a confirmation that kills the process every time it is tried (a "poison" message:
//     it would otherwise restart the poller forever and stall every shop behind it).
// So the handled PDF messages and a per-key attempt counter live in a small JSON file. It is
// kept in the container's writable layer, which survives a restart of the same container
// (an OOM kill included) but not a rebuild — fine: a rebuild brings new code with it.
//
// With no file given (unit tests, a dev run) the same logic simply lives in memory.

const HANDLED_CAP = 500;
const ATTEMPTS_CAP = 200;

interface GuardState {
  handled: string[];
  attempts: Record<string, number>;
}

export interface PollerGuard {
  // true the first time a key is claimed, false ever after (also after a restart).
  claim(key: string): boolean;
  // Counts one more try at `key` and returns how many tries it has had, this one included.
  // Written down BEFORE the work starts, so a crash inside it still counts.
  beginAttempt(key: string): number;
  // The work finished (or was given up for good): forget the tries.
  finishAttempt(key: string): void;
}

function readState(file: string): GuardState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<GuardState>;
    return {
      handled: Array.isArray(parsed.handled) ? parsed.handled.filter((key) => typeof key === "string") : [],
      attempts: parsed.attempts && typeof parsed.attempts === "object" ? { ...parsed.attempts } : {},
    };
  } catch {
    return { handled: [], attempts: {} };
  }
}

export function createPollerGuard(file?: string | null): PollerGuard {
  const state: GuardState = file ? readState(file) : { handled: [], attempts: {} };
  const handled = new Set(state.handled);

  // Written through a temp file and renamed, so a kill mid-write can't leave half a file.
  const save = () => {
    if (!file) return;
    try {
      const attemptKeys = Object.keys(state.attempts);
      for (const key of attemptKeys.slice(0, Math.max(0, attemptKeys.length - ATTEMPTS_CAP))) delete state.attempts[key];
      const snapshot: GuardState = { handled: [...handled], attempts: state.attempts };
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(snapshot));
      fs.renameSync(temp, file);
    } catch (error) {
      // Without the file the guard still works for as long as this process lives.
      console.error("[zalo-poller] could not save its state file:", error);
    }
  };

  return {
    claim(key) {
      if (handled.has(key)) return false;
      handled.add(key);
      if (handled.size > HANDLED_CAP) handled.delete(handled.values().next().value as string);
      save();
      return true;
    },
    beginAttempt(key) {
      const count = (state.attempts[key] ?? 0) + 1;
      state.attempts[key] = count;
      save();
      return count;
    },
    finishAttempt(key) {
      if (!(key in state.attempts)) return;
      delete state.attempts[key];
      save();
    },
  };
}
