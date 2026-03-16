import init, { Archive, Vote } from "bv-wasm";
import { get, set } from "idb-keyval";
import { browser } from "wxt/browser";

/** Delay before batching dirty archive writes to IndexedDB. */
const SAVE_DEBOUNCE_MS = 10000;
/** Minimum delay between queued archive mutation requests for a subreddit. */
const REQUEST_INTERVAL_MS = 5000;
/** Cooldown applied after the wasm layer reports a rate-limit error. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;
/** Marker substring emitted by the wasm layer when Reddit-side rate limiting occurs. */
const RATE_LIMITED_ERROR = "BLIND_VOTE_RATE_LIMITED";

/** In-memory archive instances keyed by subreddit name. */
let archives = new Map<string, Archive>();
/** Pending debounce timer for flushing dirty archives. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Promise chain per subreddit used to serialize archive operations. */
const subQueues = new Map<string, Promise<void>>();
/**
 * Suspends the current task for the requested duration.
 *
 * @param ms Milliseconds to wait before resolving.
 * @returns A promise that resolves after the timeout elapses.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Converts unknown thrown values into a stable string message for logging and responses.
 *
 * @param error Thrown value from a failing async operation.
 * @returns A human-readable error message.
 */
function normalizeErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Detects whether an error represents the wasm archive layer's rate-limit signal.
 *
 * @param error Thrown value to inspect.
 * @returns `true` when the error message contains the configured rate-limit marker.
 */
function isRateLimitError(error: unknown): boolean {
  return normalizeErrorMessage(error).includes(RATE_LIMITED_ERROR);
}

/**
 * Re-runs an archive task after rate-limit failures until it succeeds or fails for another reason.
 *
 * @param sub Subreddit whose queue is being processed.
 * @param task Async archive operation to execute.
 * @returns A promise that resolves after a successful run.
 */
async function runWithRateLimitRetry(sub: string, task: () => Promise<void>): Promise<void> {
  while (true) {
    try {
      await task();
      return;
    } catch (error) {
      if (!isRateLimitError(error)) {
        throw error;
      }

      console.warn(`Rate limited while processing r/${sub}. Retrying in ${RATE_LIMIT_COOLDOWN_MS / 1000} seconds...`);
      await sleep(RATE_LIMIT_COOLDOWN_MS);
    }
  }
}

/**
 * Appends work to a per-subreddit queue so archive operations stay serialized.
 *
 * @param sub Subreddit queue to append to.
 * @param task Async operation to run after prior work for the subreddit completes.
 * @returns A promise for the enqueued task itself.
 */
function enqueueTask(sub: string, task: () => Promise<void>): Promise<void> {
  const currentQueue = subQueues.get(sub) || Promise.resolve();
  const taskPromise = currentQueue.then(task);
  const nextQueue = taskPromise.catch((e) => {
    console.error(`Task failed in queue for r/${sub}:`, e);
  });
  subQueues.set(sub, nextQueue);
  return taskPromise;
}

/**
 * Loads a subreddit archive from IndexedDB or creates a fresh archive when none exists.
 *
 * Corrupt persisted data is discarded and replaced with a new archive instance.
 *
 * @param sub Subreddit whose archive should be returned.
 * @returns The cached or newly loaded archive instance.
 */
const getOrLoadArchive = async (sub: string): Promise<Archive> => {
  if (archives.has(sub)) {
    return archives.get(sub)!;
  }

  console.log(`Loading Archive for r/${sub}`);

  // attempts to get Archive bytes from IndexedDB through idb-keyval
  const bytes = await get<Uint8Array>(`archive_${sub}`);

  let archive: Archive;
  if (bytes) {
    // If bytes exist, deserialize into Archive
    try {
      archive = Archive.from_bytes(bytes);
      console.log(`Loaded Archive for r/${sub}`);
    } catch (e) {
      console.error(`Data corrupt, creating new Archive for r/${sub}`, e);
      archive = new Archive();
    }
  } else {
    console.log(`Archive does not exist, creating new Archive for r/${sub}`);
    archive = new Archive();
  }

  archives.set(sub, archive);
  return archive;
};

/**
 * Persists every dirty in-memory archive to IndexedDB.
 *
 * @returns A promise that resolves after all pending archive saves complete.
 */
const saveDirtyArchives = async () => {
  console.log("Saving dirty Archives...");

  const savePromises = Array.from(archives.keys()).map((sub) => {
    return enqueueTask(sub, async () => {
      const archive = archives.get(sub);
      // If changes occurred
      if (archive && archive.is_dirty()) {
        try {
          const bytes = archive.to_vec();
          // idb-keyval set
          await set(`archive_${sub}`, bytes);
          archive.mark_clean();
          console.log(`Saved r/${sub}`);
        } catch (e) {
          console.error(`"Failed to save r/${sub}"`, e);
        }
      }
    });
  });

  await Promise.all(savePromises);
};

/**
 * Schedules a debounced flush of dirty archives.
 */
const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDirtyArchives, SAVE_DEBOUNCE_MS);
};

export default defineBackground({
  /**
   * Initializes the background worker, loads the wasm module, and handles runtime messages.
   */
  main() {
    const wasmReady = init({
      module_or_path: browser.runtime.getURL("/bv_wasm_bg.wasm" as any),
    });

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "insert_baseline") {
        const { sub, postId } = message;

        // Enter queue
        enqueueTask(sub, async () => {
          await wasmReady;
          const archive = await getOrLoadArchive(sub);
          await runWithRateLimitRetry(sub, () => archive.insert_baseline(postId));
          scheduleSave();
          await sleep(REQUEST_INTERVAL_MS);
        })
          .then(() => {
            console.log(`Baseline post ${postId} for r/${sub} inserted`);
            sendResponse({ ok: true });
          })
          .catch((error) => {
            sendResponse({ ok: false, error: normalizeErrorMessage(error) });
          });

        return true; // keep message channel open
      }

      if (message.type === "insert_vote") {
        const { sub, postId, vote }: { sub: string; postId: string; vote: Vote } = message;

        (async () => {
          try {
            await wasmReady;
            const archive = await getOrLoadArchive(sub);
            // vote is passed as a number matching the Vote enum
            await runWithRateLimitRetry(sub, () => archive.insert_vote(postId, vote));
            scheduleSave();
            sendResponse({ ok: true });
            console.log(`Vote for post ${postId} in r/${sub} inserted`);
          } catch (error) {
            sendResponse({ ok: false, error: normalizeErrorMessage(error) });
          }
        })();

        return true;
      }

      if (message.type === "save_dirty") {
        // flush IMMEDIATELY
        if (saveTimer) clearTimeout(saveTimer);

        wasmReady
          .then(() => saveDirtyArchives())
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: String(e) }));

        return true;
      }
    });
  },
});
