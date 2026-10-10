#!/usr/bin/env node
import { main } from "./flow.ts";

main(process.argv.slice(2)).then(
  // Exit explicitly: the emulator keeps running on its own, nothing of ours should keep the terminal waiting
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
