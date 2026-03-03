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

function injectStylesIntoShadow(host: Element) {
  const shadow = host.shadowRoot;
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
  runAt: "document_start",

  main(ctx) {
    const processPosts = () => {
      const posts = document.querySelectorAll(
        "shreddit-post, shreddit-ad-post",
      );

      posts.forEach((post) => {
        injectStylesIntoShadow(post);
      });
    };

    processPosts();

    const observer = new MutationObserver(() => {
      processPosts();
    });

    observer.observe(document.body, {
      childList: true,
    });

    ctx.onInvalidated(() => observer.disconnect());
  },
});
