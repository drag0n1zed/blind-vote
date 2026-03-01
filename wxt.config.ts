import { defineConfig } from "wxt";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  srcDir: "src",
  vite: () => ({
    plugins: [wasm(), topLevelAwait()],
  }),
});
