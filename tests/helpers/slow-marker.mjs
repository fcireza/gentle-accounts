// Preload for the e2e tests (node --import): makes every write of a session marker take 400 ms, so a
// signal sent right after the fake gentle-shell is READY lands while the launcher is still inside onSpawn.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const real = fs.renameSync;
fs.renameSync = (from, to) => {
  if (String(to).endsWith(".gentle-accounts-session.json")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  return real(from, to);
};
syncBuiltinESMExports();
