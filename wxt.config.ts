import { execSync } from "child_process";
import { defineConfig } from "wxt";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  vite: () => ({
    plugins: [wasm(), topLevelAwait()],
  }),

  hooks: {
    // Compile wasm
    "build:before": (wxt) => {
      execSync("wasm-pack build --target web", {
        cwd: "./wasm",
        stdio: "inherit",
      });
    },
  },

  manifest: {
    permissions: ["storage"],
    web_accessible_resources: [
      {
        matches: ["*://*.reddit.com/*"],
        resources: ["/bv_wasm_bg.wasm"],
      },
    ],
  },
});
