import { browser } from "wxt/browser";

/**
 * Vote enum matching the Rust definition.
 * 0 = Up, 1 = Down, 2 = NA
 */
enum Vote {
  Up = 0,
  Down = 1,
  NA = 2,
}

// TODO: create settings for this
/** Subreddits where blind-vote behavior is enabled. */
const ENABLED_SUBREDDITS = new Set(["rust", "sssdfg"]);

/** CSS injected into Reddit post shadow roots to hide vote and comment signals by default. */
const HIDE_VOTES = `
    /* Hide vote count */
    [data-post-click-location="vote"] faceplate-number {
      display: none !important;
    }

    /* Hide comment count */
    span:has(> .icon-comment) + span,
    span:has(> [icon-name="comment"]) + span {
      display: none !important;
    }

    /* Hide award button */
    award-button {
      display: none !important;
    }

    /* Reveal */
    :has(button[aria-pressed="true"]) [data-post-click-location="vote"] faceplate-number,
    :has(button[aria-pressed="true"]) span:has(> .icon-comment) + span,
    :has(button[aria-pressed="true"]) award-button {
      display: inline-block !important;
    }
`;

/**
 * Injects the blind-vote stylesheet into a post shadow root once.
 *
 * @param post Reddit post element that may expose a shadow root.
 */
function injectStylesIntoShadow(post: Element) {
  const shadow = post.shadowRoot;
  if (!shadow) return;

  // Avoid duplicate injections
  if (shadow.querySelector("style[data-blind-vote]")) return;

  const styleTag = document.createElement("style");
  styleTag.setAttribute("data-blind-vote", "true");
  styleTag.textContent = HIDE_VOTES;
  shadow.appendChild(styleTag);
}

export default defineContentScript({
  matches: ["*://*.reddit.com/*"],

  /**
   * Watches Reddit post elements, injects hiding styles, and records baselines for enabled subreddits.
   *
   * @param ctx Content script lifecycle context provided by WXT.
   */
  async main(ctx) {
    const processedPostIds = new Set<string>();

    /**
     * Processes visible posts, injecting styles and sending unseen enabled posts to the background worker.
     */
    const processPosts = async () => {
      const posts = document.querySelectorAll("shreddit-post");

      for (const post of posts) {
        injectStylesIntoShadow(post);
      }

      for (const post of posts) {
        let postId = post.getAttribute("id");
        if (!postId || processedPostIds.has(postId)) continue;

        processedPostIds.add(postId);

        // Get subreddit name, e.g. "sssdfg"
        const sub = (post.getAttribute("subreddit-name") || "").toLowerCase();
        if (!ENABLED_SUBREDDITS.has(sub)) continue;

        try {
          console.log(`inserting baseline post for ${postId} in ${sub}`);
          await browser.runtime.sendMessage({ type: "insert_baseline", sub, postId });
        } catch (e) {
          console.error(`Error processing post ${postId}`, e);
        }
      }
    };

    processPosts();

    const observer = new MutationObserver(() => {
      processPosts();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("beforeunload", () => {
      browser.runtime.sendMessage({ type: "save_dirty" }); // SAVE SAVE SAVE GO GO GO GO GO GO SAVE RIGHT NOW
    });

    /**
     * Handles global click events to detect and record votes on enabled subreddits.
     *
     * Uses event delegation to capture clicks inside Shadow DOM boundaries via `composedPath()`.
     * Identifies vote buttons by common attributes (upvote/downvote)
     * and sends an `insert_vote` message to the background worker.
     *
     * @param event The native DOM click event.
     */
    const onVoteClick = async (event: Event) => {
      const path = event.composedPath();

      // Find the host post
      const post = path.find((el) => el instanceof Element && el.tagName === "SHREDDIT-POST") as Element | undefined;

      if (!post) return;

      // Find if an upvote or downvote button was clicked
      const button = path.find((el) => {
        return el instanceof Element && (el.hasAttribute("upvote") || el.hasAttribute("downvote"));
      }) as Element | undefined;

      if (!button) return;

      // Determine vote type
      let voteType = Vote.NA;

      if (button.hasAttribute("upvote")) {
        voteType = Vote.Up;
      } else if (button.hasAttribute("downvote")) {
        voteType = Vote.Down;
      }

      if (voteType === Vote.NA) return;

      const postId = post.getAttribute("id");
      const sub = (post.getAttribute("subreddit-name") || "").toLowerCase();

      // Only process if valid post and enabled sub
      if (postId && sub && ENABLED_SUBREDDITS.has(sub)) {
        try {
          console.log(`inserting vote for ${postId} in ${sub}`);
          await browser.runtime.sendMessage({
            type: "insert_vote",
            sub,
            postId,
            vote: voteType,
          });
        } catch (e) {
          console.error(`Error sending vote for post ${postId}`, e);
        }
      }
    };

    document.addEventListener("click", onVoteClick);

    ctx.onInvalidated(() => {
      observer.disconnect();
      document.removeEventListener("click", onVoteClick);
      browser.runtime.sendMessage({ type: "save_dirty" });
    });
  },
});
