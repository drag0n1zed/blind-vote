import { browser } from "wxt/browser";

export const ENABLED_SUBREDDITS_STORAGE_KEY = "enabledSubreddits";
export const DEFAULT_ENABLED_SUBREDDITS = ["rust", "sssdfg"] as const;

/**
 * Normalizes a subreddit name so storage and runtime lookups are consistent.
 *
 * @param value Subreddit name with or without an `r/` prefix.
 * @returns Lowercased subreddit name without the `r/` prefix.
 */
export function normalizeSubredditName(value: string): string {
  return value.trim().replace(/^r\//i, "").toLowerCase();
}

/**
 * Deduplicates and normalizes a subreddit list while preserving the first-seen order.
 *
 * @param subreddits Untrusted subreddit names from UI or storage.
 * @returns A clean subreddit list safe to persist.
 */
export function normalizeSubredditList(subreddits: Iterable<string>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const subreddit of subreddits) {
    const value = normalizeSubredditName(subreddit);
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

/**
 * Converts a raw storage value into the effective subreddit list.
 *
 * Missing or invalid values fall back to the built-in defaults, but an explicitly empty
 * array remains empty so the user can disable blind-vote everywhere if they want to.
 *
 * @param value Raw browser storage value.
 * @returns Effective enabled subreddit list.
 */
export function parseEnabledSubredditsValue(value: unknown): string[] {
  if (value === undefined) {
    return [...DEFAULT_ENABLED_SUBREDDITS];
  }

  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_SUBREDDITS];
  }

  return normalizeSubredditList(value.filter((entry): entry is string => typeof entry === "string"));
}

/**
 * Reads the enabled subreddit list from browser storage.
 *
 * @returns The effective enabled subreddit list.
 */
export async function getEnabledSubreddits(): Promise<string[]> {
  const stored = await browser.storage.local.get(ENABLED_SUBREDDITS_STORAGE_KEY);
  return parseEnabledSubredditsValue(stored[ENABLED_SUBREDDITS_STORAGE_KEY]);
}

/**
 * Persists the enabled subreddit list to browser storage.
 *
 * @param subreddits Subreddits to persist.
 * @returns The normalized list that was saved.
 */
export async function saveEnabledSubreddits(subreddits: Iterable<string>): Promise<string[]> {
  const normalized = normalizeSubredditList(subreddits);

  await browser.storage.local.set({
    [ENABLED_SUBREDDITS_STORAGE_KEY]: normalized,
  });

  return normalized;
}
