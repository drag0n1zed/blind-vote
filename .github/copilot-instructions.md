# Copilot Instructions for blind-vote

This repository contains a browser extension built with the WXT framework and Rust/Wasm.

## Build, Test, and Lint Commands

- **Build Extension**: `pnpm run build` (uses `wxt build`)
- **Development**: `pnpm run dev` (uses `wxt`)
- **Wasm Build**: `wasm-pack build --target web` in the `wasm/` directory.
  - This is automatically handled by the `build:before` hook in `wxt.config.ts`.
- **Testing**: No test runner is currently configured.

## High-level Architecture

This project is a browser extension for Reddit that hides vote counts and awards until the user votes.

- **Frontend**: TypeScript, WXT framework.
- **Core Logic**: Rust (`bv-wasm` crate), compiled to WebAssembly.
- **State Management**: Persisted in IndexedDB via `idb-keyval`, managed by the Wasm module in the background script.
- **Messaging**: Content scripts communicate with the background script via `browser.runtime.sendMessage`.

### Key Directories

- `entrypoints/`: Extension entry points (`background`, `content`, `popup`).
- `wasm/`: Rust source code for the `bv-wasm` crate.
- `modules/`: WXT modules (e.g., `wasm-loader.ts` for asset handling).
- `wxt.config.ts`: WXT configuration.

## Key Conventions

### Wasm Integration

- The Rust crate `bv-wasm` exposes an `Archive` struct and `Vote` enum.
- The Wasm module is loaded asynchronously in `background/index.ts`.
- Content scripts trigger Wasm actions (like `insert_vote`) by sending messages to the background script.

### Shadow DOM Interaction

- Content scripts (`entrypoints/content/index.tsx`) inject styles into the Shadow DOM of `<shreddit-post>` elements on Reddit.
- Event delegation is used with `event.composedPath()` to detect clicks on vote buttons inside Shadow DOM.

### Data Flow

1.  **Content Script**: Detects posts/votes -> Sends message (`insert_baseline`, `insert_vote`).
2.  **Background Script**: Receives message -> Calls Wasm method (`archive.insert_...`) -> Schedules save.
3.  **Wasm**: Updates in-memory state.
4.  **Persistence**: `saveDirtyArchives` serializes Wasm state and saves to IndexedDB.

### Subreddit Filtering

- Currently hardcoded `ENABLED_SUBREDDITS` in `entrypoints/content/index.tsx`.
