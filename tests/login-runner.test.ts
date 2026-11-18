import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runClaudeLoginHere } from "../src/login-runner.ts";

function harness(outcome: { code?: number | null; signal?: string; error?: Error; throws?: Error }) {
  const log: string[] = [];
  const handlers = new Set<() => void>();
  const signals = {
    on: (_s: "SIGINT", h: () => void) => void (handlers.add(h), log.push("sigint:on")),
    off: (_s: "SIGINT", h: () => void) => void (handlers.delete(h), log.push("sigint:off")),
  };
  const spawnCalls: { file: string; args: string[]; opts: { stdio?: unknown; env?: NodeJS.ProcessEnv; shell?: boolean } }[] = [];
  let sigintDuringChild = 0;
  const spawn = (file: string, args: readonly string[], opts: { stdio?: unknown; env?: NodeJS.ProcessEnv; shell?: boolean }) => {
    spawnCalls.push({ file, args: [...args], opts });
    log.push("spawn");
    sigintDuringChild = handlers.size;
    if (outcome.throws) throw outcome.throws;
    const child = new EventEmitter();
    setImmediate(() => (outcome.error ? child.emit("error", outcome.error) : child.emit("close", outcome.code === undefined ? 0 : outcome.code, outcome.signal ?? null)));
    return child as never;
  };
  const tui = { stop: () => log.push("stop"), start: () => log.push("start"), requestRender: (f?: boolean) => log.push(`render:${f}`) };
  let doneCalls = 0;
  const ctx = {
    ui: {
      custom: (factory: (tui: unknown, theme: unknown, kb: unknown, done: (r: unknown) => void) => unknown) =>
        new Promise((resolve) => {
          factory(tui, {}, {}, (r) => {
            doneCalls++;
            log.push("done");
            resolve(r);
          });
        }),
    },
  };
  return { ctx, signals, spawn, spawnCalls, log, done: () => doneCalls, sigintDuringChild: () => sigintDuringChild, handlers };
}

test("S32 same terminal: stops the TUI, inherits stdio, sets CLAUDE_CONFIG_DIR, ignores SIGINT, restores and calls done", async () => {
  const h = harness({ code: 0 });
  const r = await runClaudeLoginHere(h.ctx as never, "/tmp/a b/it's", { spawn: h.spawn, signals: h.signals, env: { PATH: "/bin", CLAUDE_CONFIG_DIR: "/old" }, platform: "linux" });
  assert.deepEqual(r, { code: 0, signal: null });
  assert.deepEqual(h.log, ["sigint:on", "stop", "spawn", "sigint:off", "start", "render:true", "done"]);
  assert.equal(h.sigintDuringChild(), 1, "SIGINT ignored while the child runs");
  assert.equal(h.handlers.size, 0);
  assert.equal(h.done(), 1);
  const call = h.spawnCalls[0];
  assert.equal(call.file, "claude");
  assert.deepEqual(call.args, ["auth", "login"]);
  assert.equal(call.opts.stdio, "inherit");
  assert.equal(call.opts.env?.CLAUDE_CONFIG_DIR, "/tmp/a b/it's");
  assert.equal(call.opts.env?.PATH, "/bin");
  assert.equal(call.opts.shell, false);
});

test("S32 same terminal: the default profile removes CLAUDE_CONFIG_DIR from the child env; win32 uses a shell for the .cmd shim", async () => {
  const h = harness({ code: 0 });
  await runClaudeLoginHere(h.ctx as never, undefined, { spawn: h.spawn, signals: h.signals, env: { CLAUDE_CONFIG_DIR: "/old" }, platform: "win32" });
  assert.equal("CLAUDE_CONFIG_DIR" in (h.spawnCalls[0].opts.env ?? {}), false);
  assert.equal(h.spawnCalls[0].opts.shell, true);
});

test("S32 same terminal: a failing, missing or throwing child still restores the TUI and calls done", async () => {
  for (const outcome of [{ code: 1 }, { code: null, signal: "SIGTERM" }, { error: new Error("spawn claude ENOENT") }, { throws: new Error("boom") }]) {
    const h = harness(outcome);
    const r = await runClaudeLoginHere(h.ctx as never, "/d", { spawn: h.spawn, signals: h.signals, env: {}, platform: "linux" });
    assert.deepEqual(h.log.slice(-4), ["sigint:off", "start", "render:true", "done"], JSON.stringify(outcome));
    assert.equal(h.done(), 1);
    if (outcome.error || outcome.throws) assert.ok("error" in r);
    else assert.deepEqual(r, { code: outcome.code, signal: outcome.signal ?? null });
  }
});
