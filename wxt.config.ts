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
        cwd: "./wasm/bv-calc",
        stdio: "inherit",
      });
      execSync("wasm-pack build --target web", {
        cwd: "./wasm/bv-collect",
        stdio: "inherit",
      });
    },
  },

  manifest: {
    permissions: ["storage", "unlimitedStorage"],
  },
});
