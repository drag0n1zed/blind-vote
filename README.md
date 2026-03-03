None of this is the actual plan.

## Phase 1: Infrastructure & Configuration

- [x] **WXT Scaffold:** WXT project initialized with pnpm workspace.
- [x] **Manifest V3 (`wxt.config.ts`):**
  - [x] `content_scripts` targeting `*://*.reddit.com/*` with `runAt: "document_start"`
  - [x] `vite-plugin-wasm` and `vite-plugin-top-level-await` installed and configured
- [x] **WASM Workspace (`/wasm`):** Three-crate Cargo workspace established:
  - [x] `bv-shared` — core data model, no WASM-specific dependencies
  - [x] `bv-collect` — content script WASM module
  - [x] `bv-calc` — popup WASM module
- [x] **WASM Link:** `node_modules/blind-vote-wasm` symlinked to `wasm/pkg`
- [ ] **Storage Permission:** Declare `storage` in manifest permissions.
- [ ] **Build Scripts:** Wire `wasm-pack build` for both `bv-collect` and `bv-calc` into
  `package.json` dev/build scripts.

---

## Phase 2: Data Model (`bv-shared`)

Pure Rust library crate. No `wasm_bindgen`, no `cdylib`. Internal dependency of both
`bv-collect` and `bv-calc`. Contains all shared types and their core logic.

**Dependencies:** `serde` (derive), `postcard` (alloc feature), `rustc-hash`

- [x] **`PostInfo` Struct:**
  ```rust
  pub struct PostInfo {
      timestamp: u64,    // UNIX timestamp of post creation
      post_score: u32,   // Net post karma (floors at 0 on Reddit's public API/UI)
      upvote_ratio: f32, // Upvote fraction (0.0–1.0)
  }
  ```

- [x] **`Vote` Enum:**
  ```rust
  pub enum Vote {
      Up(PostInfo),
      Down(PostInfo),
      NA,   // Age-filtered vote. PostInfo is not stored here — it was
            // already captured independently by the Baseline Vacuum.
  }
  ```

- [x] **`Archive` Struct:**
  ```rust
  pub struct Archive {
      votes: FxHashMap<String, Vote>, // post_id → Vote (write-once)
      baseline_posts: Vec<PostInfo>,  // sorted by timestamp
  }
  ```

- [x] **`Archive` impl:**
  - [x] `new()` — default-initializes both fields
  - [x] `to_vec() -> Vec<u8>` — postcard serialization
  - [x] `from_bytes(bytes: &[u8]) -> Self` — postcard deserialization
  - [x] `insert_vote(post_id: String, vote: Vote)` — write-once via `.entry().or_insert()`
  - [x] `insert_baseline(post_info: PostInfo)` — O(log n) sorted insertion via
    `partition_point()`

---

## Phase 3: WASM Bridges (`bv-collect` and `bv-calc`)

Both are `cdylib` crates depending on `bv-shared` + `wasm_bindgen`. Each exposes a JS
class named `Archive` (via `#[wasm_bindgen(js_name = "Archive")]`) wrapping an internal
`ArchiveHandle` struct. Complex types (`PostInfo`, `Vote`) are constructed entirely on the
Rust side and never cross the JS boundary — all parameters are primitives.

### `bv-collect` — Content Script Interface

- [x] `new()` — constructor
- [x] `from_bytes(bytes: &[u8]) -> Self` — accepts `Uint8Array`, rehydrates from storage
- [x] `to_vec() -> Vec<u8>` — returns `Uint8Array` for storage
- [x] `insert_vote(post_id: String, direction: u8, timestamp: u64, post_score: u32,
  upvote_ratio: f32)` — `direction`: `0`=Up, `1`=Down, `2`=NA
- [x] `insert_baseline(timestamp: u64, post_score: u32, upvote_ratio: f32)`

### `bv-calc` — Popup Interface

- [ ] `from_bytes(bytes: &[u8]) -> Self` — rehydration (same pattern as `bv-collect`)
- [ ] All analytics methods (see Phase 5)

---

## Phase 4: Content Script (DOM & Scrapers)

### Shadow DOM Injection

- [x] Declarative CSS string to hide clout elements within `shreddit-post` shadow roots:
  ```css
  [data-post-click-location="vote"] faceplate-number,
  span:has(> .icon-comment) + span,
  award-button { display: none !important; }
  ```
- [x] "Reveal" CSS toggled by host class:
  ```css
  :host(.is-revealed) ... { display: inline-block !important; }
  ```
- [x] `MutationObserver` watching for new `shreddit-post` host elements
- [x] Function to safely pierce `shadowRoot` and append the `<style>` tag

### Passive Scraper — Baseline Vacuum

Fires for every visible post regardless of user interaction. Builds the statistical
baseline over time.

- [ ] `IntersectionObserver` on `<shreddit-post>` elements
- [ ] Scrape `post_id`, `subreddit_id`, `created-at`, `post_score`, `upvote_ratio`
- [ ] Load or create that subreddit's `Archive`:
  ```typescript
  const subrKey = `archive_${subrId}`;
  const stored = await browser.storage.local.get(subrKey);
  const archive = stored[subrKey]
      ? Archive.from_bytes(new Uint8Array(stored[subrKey]))
      : new Archive();
  ```
- [ ] **Density Guard (before insertion):** Check count within the ±6-month window of
  the incoming timestamp. If `window.count() >= 1,067` for this subreddit/era, drop the
  payload to prevent Baseline Bloat.
- [ ] Call `archive.insert_baseline(timestamp, postScore, upvoteRatio)` if guard passes
- [ ] Persist: `browser.storage.local.set({ [subrKey]: archive.to_vec() })`

### Active Scraper — Vote Event Retargeter

Fires only on deliberate user vote clicks. Records the user's judgment before clout
is revealed.

- [ ] Global `click` listener on `document`
- [ ] `event.composedPath()` to identify `button[upvote]` / `button[downvote]` through
  the Shadow DOM boundary
- [ ] Scrape `post_id`, `subreddit_id`, `created-at`, `post_score`, `upvote_ratio`,
  `aria-pressed` state (determines direction)
- [ ] **Age Filter:** If post age < 24h or > 6 months, force `direction = 2` (NA) to
  exclude volatile/stale data from vote records
- [ ] Call `archive.insert_vote(postId, direction, timestamp, postScore, upvoteRatio)`
- [ ] Persist archive back to `browser.storage.local`
- [ ] Append `.is-revealed` class to the host `shreddit-post` element (triggers reveal CSS)

### Multi-Tab Storage Sync

- [ ] Debounced/throttled writes — batch persistence calls to avoid storage thrashing
- [ ] `browser.storage.onChanged` listener — when another tab updates an
  `archive_${subr_id}` key, rehydrate the current tab's hot WASM instance

---

## Phase 5: Analytics Engine (`bv-calc`)

The popup instantiates up to 5 `Archive` objects in parallel (one per user-selected
subreddit) and calls these methods on each. All computation happens in Rust.

```typescript
const subrIds = await getUserOptInList(); // up to 5
const blobs = await browser.storage.local.get(subrIds.map(id => `archive_${id}`));
const archives = subrIds.map(id =>
    Archive.from_bytes(new Uint8Array(blobs[`archive_${id}`]))
);
// archives[0..4] → call stat methods → render
```

- [ ] **1,067 Nearest Neighbors:**
  - [ ] For a given vote at time T, `binary_search` into `baseline_posts` for the nearest
    temporal index
  - [ ] Bidirectional two-pointer expansion collecting the closest 1,067 `PostInfo`
    entries by |T_vote − T_base|

- [ ] **Linear Decay Weighting (KDE):**
  - [ ] MaxDeltaT = largest |T_vote − T_base| in the 1,067 sample
  - [ ] Per-point weight: \(w_i = \max(0,\ \text{MaxDeltaT} - \Delta t_i)\)
  - [ ] Weighted mean upvote ratio: \(\displaystyle\frac{\sum(w_i \times
    \text{upvote\_ratio}_i)}{\sum w_i}\)

- [ ] **Statistical Significance Flag:** If the two-pointer expansion hits a vector
  boundary before reaching n = 1,067, flag the result as below the 3% margin of error /
  95% confidence threshold.

- [ ] **Alignment & Alpha:**
  - [ ] Compare `Vote` variant against weighted mean upvote ratio → alignment bool
  - [ ] Subreddit volatility = standard deviation of the KDE sample's upvote ratios

- [ ] **Density / Gap Map:** For each subreddit, identify which monthly windows are below
  n < 1,067 and return structured gap data for the "Homework" UI.

---

## Phase 6: Popup Dashboard

- [ ] Subreddit opt-in selection UI (drives which archives are fetched and calculated)
- [ ] **Global Alignment:** "X% of your votes aligned with the hivemind"
- [ ] **Independent Alpha:** Per-subreddit deviation from hivemind mean
- [ ] **Data Quality:** "X% of your votes were compared against a statistically
  significant baseline"
- [ ] **Homework / Gaps:** "Progress: 840/1,067 posts mapped for r/technology (Q3 2023)"
  — tells the user which subreddit/era windows need more passive scrolling

---

## Phase 7: Data Sovereignty

- [ ] **Anonymized Export:** `bv-calc` method that strips all post/subreddit identifiers
  and returns a pure JSON string of temporal alignment percentages and volatilities
- [ ] **"Copy Research Data" button** in popup UI
- [ ] **"Purge Archive" button** — wipes all `archive_*` keys from
  `browser.storage.local` and nullifies the in-memory WASM state
```
