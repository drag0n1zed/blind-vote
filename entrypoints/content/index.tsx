import { browser } from "wxt/browser";

// TODO: create settings for this
const ENABLED_SUBREDDITS = new Set(["rust", "sssdfg"]);

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

  async main(ctx) {
    const processedPostIds = new Set<string>();

    const processPosts = async () => {
      const posts = document.querySelectorAll("shreddit-post, shreddit-ad-post");

      for (const post of posts) {
        injectStylesIntoShadow(post);

        let postId = post.getAttribute("id");
        if (!postId || processedPostIds.has(postId)) continue;

        processedPostIds.add(postId);

        // Get subreddit name, e.g. "sssdfg"
        const sub = (post.getAttribute("subreddit-name") || "").toLowerCase();
        if (!ENABLED_SUBREDDITS.has(sub)) continue;

        try {
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

    ctx.onInvalidated(() => {
      observer.disconnect();
      browser.runtime.sendMessage({ type: "save_dirty" });
    });
  },
});
