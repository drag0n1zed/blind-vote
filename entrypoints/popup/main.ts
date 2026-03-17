import { getEnabledSubreddits, normalizeSubredditList, saveEnabledSubreddits } from "../../lib/subreddit-settings";

type StatusTone = "idle" | "success" | "error";

const form = document.querySelector<HTMLFormElement>("#settings-form");
const textarea = document.querySelector<HTMLTextAreaElement>("#subreddit-list");
const saveButton = document.querySelector<HTMLButtonElement>("#save-button");
const status = document.querySelector<HTMLParagraphElement>("#status");

if (!form || !textarea || !saveButton || !status) {
  throw new Error("Blind Vote popup failed to initialize.");
}

/**
 * Converts unknown thrown values into a stable string message for the popup.
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
 * Updates the popup status message.
 *
 * @param message Message shown to the user.
 * @param tone Visual tone for the message.
 */
function setStatus(message: string, tone: StatusTone = "idle") {
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

/**
 * Formats the current subreddit list into textarea text.
 *
 * @param subreddits Stored subreddit names.
 * @returns One subreddit per line.
 */
function formatSubreddits(subreddits: readonly string[]): string {
  return subreddits.join("\n");
}

/**
 * Parses textarea content into a normalized subreddit list.
 *
 * @param value Raw textarea content.
 * @returns Clean subreddit names ready to save.
 */
function parseTextareaValue(value: string): string[] {
  return normalizeSubredditList(value.split(/\r?\n|,/g));
}

/**
 * Updates the popup controls during async work.
 *
 * @param busy Whether the popup is waiting on storage.
 */
function setBusy(busy: boolean) {
  if (!textarea || !saveButton) return;
  textarea.disabled = busy;
  saveButton.disabled = busy;
}

/**
 * Loads the saved subreddit settings into the popup.
 */
async function loadSettings() {
  setBusy(true);

  try {
    if (!textarea) throw "textarea is null";
    const subreddits = await getEnabledSubreddits();
    textarea.value = formatSubreddits(subreddits);
    setStatus(
      subreddits.length === 0
        ? "Blind Vote is currently disabled for all subreddits."
        : `Loaded ${subreddits.length} enabled subreddit${subreddits.length === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    console.error("Failed to load enabled subreddits", error);
    setStatus(`Failed to load settings: ${normalizeErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);

  try {
    const savedSubreddits = await saveEnabledSubreddits(parseTextareaValue(textarea.value));
    textarea.value = formatSubreddits(savedSubreddits);
    setStatus(
      savedSubreddits.length === 0
        ? "Saved. Blind Vote is now disabled for all subreddits."
        : `Saved ${savedSubreddits.length} subreddit${savedSubreddits.length === 1 ? "" : "s"}.`,
      "success",
    );
  } catch (error) {
    console.error("Failed to save enabled subreddits", error);
    setStatus(`Failed to save settings: ${normalizeErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
});

void loadSettings();
