import { resolve } from "node:path";
import { defineWxtModule } from "wxt/modules";

export default defineWxtModule((wxt) => {
  wxt.hook("build:publicAssets", (_, assets) => {
    assets.push({
      absoluteSrc: resolve("wasm/pkg/bv_wasm_bg.wasm"),
      relativeDest: "bv_wasm_bg.wasm",
    });
  });
});
