"use strict";
import init, { add } from "blind-vote-wasm";

async function run() {
  await init();
  let message = add(1, 2);
  console.log(message);
}

run();
