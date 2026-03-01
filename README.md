# System Design & Implementation Checklist: Blind-Vote Hivemind Research Extension

**Document Purpose:** This serves as the architectural blueprint and exhaustive development checklist for a Manifest V3 browser extension built with WXT, TypeScript, and a Rust WebAssembly (WASM) core. The system is designed to pierce Reddit's Shadow DOM, hide social proof ("clout"), record double-blind voting behaviors, and passively map subreddit statistical baselines to calculate user-to-hivemind alignment.

Note: Yes, this is AI generated. I was heavily involved in this. The best way to avoid getting replaced by it is to starting using it in your workflow.

---

## Phase 1: Infrastructure & Configuration (WXT & Vite)
*   [x] **WXT Scaffold:** Initialize the Vite-based WXT project environment.
*   [ ] **Manifest V3 Configuration (`wxt.config.ts`):**
    *   [ ] Define `content_scripts` targeting `*://*.reddit.com/*` with `runAt: "document_start"`.
    *   [ ] Add `"storage"` and `"unlimitedStorage"` permissions (essential to bypass the standard 5MB `browser.storage.local` quota for the binary archive).
*   [ ] **WASM Build Pipeline:** Configure Vite plugins (e.g., `vite-plugin-wasm`, `vite-plugin-top-level-await`) to compile and bundle the `blind-vote-wasm` Rust crate.

## Phase 2: Rust WASM Core & Data Modeling (The Binary Archive)
*   [ ] **Crate Dependencies:** Add `serde`, `serde_wasm_bindgen`, `bincode` (for compact binary serialization), and `fxhash`/`twox-hash` ($O(1)$ fast non-cryptographic hashing).
*   [ ] **Data Structures (Structs & Enums):**
    *   [ ] `UserVote`: Trinary Enum (`Upvote`, `Downvote`, `NA`).
    *   [ ] `VoteRecord`: Struct for Active Data (`post_hash: u64`, `sub_hash: u64`, `timestamp: u64`, `reddit_score: i32`, `upvote_ratio: f32`, `user_vote: UserVote`).
    *   [ ] `BaselinePoint`: Struct for Passive Data (`post_hash: u64`, `sub_hash: u64`, `timestamp: u64`, `upvote_ratio: f32`).
    *   [ ] `Archive`: The root State Engine struct containing `votes: Vec<VoteRecord>` (Sorted), `baseline: Vec<BaselinePoint>` (Sorted), and `guard: HashSet<u64>`.
*   [ ] **Serialization Bridge:**
    *   [ ] Write `Archive::to_bytes()` mapping the state to a `bincode` byte array (`Vec<u8>`).
    *   [ ] Write `Archive::from_bytes(Uint8Array)` constructor for Ephemeral/Tab Lifecycle rehydration.
*   [ ] **Hashing Utility:** Write a helper to strip Reddit base-36 prefixes (`t3_`, `t5_`) and hash the remaining string into a `u64` identifier.

## Phase 3: The Content Script (DOM Manipulation & Scrapers)
*   [x] **Shadow Injection (CSS):**
    *   [x] Write the declarative CSS string to hide clout: `[data-post-click-location="vote"] faceplate-number, span:has(> .icon-comment) + span, award-button { display: none !important; }`.
    *   [x] Write the "Reveal" CSS using the Host selector: `:host(.is-revealed) ... { display: inline-block !important; }`.
    *   [x] Implement a `MutationObserver` to watch for new `shreddit-post` (Host) elements.
    *   [x] Write a function to safely pierce the `shadowRoot` and append the `<style>` tag.
*   [ ] **Passive Scraper (The Baseline Vacuum):**
    *   [ ] Attach an `IntersectionObserver` to visible `<shreddit-post>` elements.
    *   [ ] Scrape: `post_id`, `subreddit_id`, `created-at` (Unix timestamp), and `upvote_ratio`.
    *   [ ] Send payload to the WASM Passive Recorder.
*   [ ] **Active Scraper (The Event Retargeter):**
    *   [ ] Attach a global `click` listener on the `document`.
    *   [ ] Utilize `event.composedPath()` to identify clicks on `button[upvote]` or `button[downvote]` deeply nested in the Shadow DOM.
    *   [ ] Scrape the same identifiers, plus `faceplate-number` (raw clout) and the `aria-pressed` state.
    *   [ ] Send payload to the WASM Active Recorder.
    *   [ ] Hydrate the DOM by appending the `.is-revealed` class to the Host `shreddit-post`.

## Phase 4: WASM Gatekeeper (Density Filtering & Immutable State)
*   [ ] **The Write-Once Guard:** Upon receiving *any* payload, check the $O(1)$ `HashSet<u64>` guard. If `post_hash` exists, drop the operation (Immutable State protection).
*   [ ] **Active Data Filtering (Votes):**
    *   [ ] Calculate `Age = CurrentTime - PostTimestamp`.
    *   [ ] Apply the < 24h / > 6mo rule: Force `user_vote = NA` to prevent highly volatile data from muddying the archive.
    *   [ ] Execute an $O(\log n)$ `binary_search` to insert the `VoteRecord` into the `votes` Vector, preserving chronological sort.
*   [ ] **Passive Data Filtering (Temporal Density Check):**
    *   [ ] Execute an $O(\log n)$ `binary_search` on the `baseline` Vector for the current `sub_hash` spanning a 1-year window (`T ± 6 months`).
    *   [ ] If `window.count() > 1067` (Statistical Significance Threshold achieved for that era), drop the payload to prevent Baseline Bloat.
    *   [ ] If `< 1067`, execute $O(\log n)$ insertion into the `baseline` Vector.
*   [ ] **Batch Persistence:** Implement a debounce/throttle in TypeScript to periodically pull the `Uint8Array` from WASM and execute `browser.storage.local.set`.
*   [ ] **Multi-Tab Sync:** Implement `browser.storage.onChanged` to catch archive updates from other tabs and rehydrate the hot WASM instance.

## Phase 5: WASM Analytics Engine (Math, Stats & The Popup)
*   [ ] **Subreddit Opt-In Selection:** Expose a method returning unique `sub_hash` lists so the user can filter calculations by specific communities.
*   [ ] **The 1,067 Nearest Neighbors Algorithm:**
    *   [ ] For a given `VoteRecord` at time $T$, execute `binary_search` in the `baseline` Vector to find the closest temporal index.
    *   [ ] Use a bidirectional Two-Pointer Expansion to slice the closest 1,067 points ($|T_{vote} - T_{base}|$).
*   [ ] **Linear Decay Weighting (Kernel Density Estimation):**
    *   [ ] Calculate maximum $\Delta t$ within the 1,067 sample.
    *   [ ] Apply weight formula: $w_i = \max(0, \text{MaxDeltaT} - \Delta t_i)$.
    *   [ ] Calculate Weighted Mean Clout: $\sum(w_i \times \text{upvote\_ratio}_i) / \sum(w_i)$.
*   [ ] **Statistical Significance Validation:**
    *   [ ] If the Two-Pointer Expansion hits vector boundaries and yields $n < 1067$, flag the calculation as lacking a **3% Margin of Error / 95% Confidence Level**.
*   [ ] **Alignment & Independent Alpha:**
    *   [ ] Compare the `UserVote` enum against the Weighted Mean Clout.
    *   [ ] Calculate Subreddit Volatility (Standard Deviation of the KDE sample).

## Phase 6: The Popup Dashboard (Visualization & "Homework")
*   [ ] **Ephemeral Initialization:** Fetch the Binary Blob from `browser.storage.local`, push to WASM constructor for full rehydration.
*   [ ] **Render Metrics:**
    *   [ ] Display "Global Alignment: X%".
    *   [ ] Display "Independent Alpha" metrics.
*   [ ] **Render Data Quality / Temporal Gaps:**
    *   [ ] Display: *"X% of your votes were compared against a statistically significant baseline."*
    *   [ ] Output "Homework" (Gaps): Calculate which months/years in specific subreddits require the user to "scroll and read more posts" to achieve $n \ge 1067$.
    *   [ ] *UI Example:* "Progress: 840/1067 posts mapped for r/technology (Q3 2023)."

## Phase 7: Data Sovereignty & Research Portability
*   [ ] **Anonymized Export Pipeline:** Create a WASM method to strip all `post_hash` and `sub_hash` data, outputting a pure JSON string of temporal alignment percentages and volatilities.
*   [ ] **Export UI:** Add a "Copy Research Data" button to the popup.
*   [ ] **Database Wipe:** Implement a "Purge Archive" button that overwrites the `browser.storage.local` Binary Blob and nullifies the WASM memory state.
