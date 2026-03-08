import init, { Archive } from "bv-wasm";
import { get, set } from "idb-keyval";
import { browser } from "wxt/browser";

// save every 2 seconds after change
const SAVE_DEBOUNCE_MS = 2000;

let archives = new Map<string, Archive>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const subQueues = new Map<string, Promise<void>>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function enqueueTask(sub: string, task: () => Promise<void>): Promise<void> {
  const currentQueue = subQueues.get(sub) || Promise.resolve();
  // Chain the new task, catching errors so one bad post doesn't break the whole queue
  const nextQueue = currentQueue
    .then(task)
    .then(() => sleep(1000))
    .catch((e) => {
      console.error(`Task failed in queue for r/${sub}:`, e);
    });
  subQueues.set(sub, nextQueue);
  return nextQueue;
}

// Helper to hydrate or create new Archive for one subreddit
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

// Save dirty archives every SAVE_DEBOUNCE_MS
const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDirtyArchives, SAVE_DEBOUNCE_MS);
};

export default defineBackground({
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
          await archive.insert_baseline(postId);
          scheduleSave();
        }).then(() => {
          sendResponse({ ok: true });
        });

        return true; // keep message channel open
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
