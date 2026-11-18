#!/usr/bin/env node
// Launcher: `gentle-accounts <name> [gentle-shell args...]`.
// Runs the TypeScript sources through Node's built-in type stripping (Node >= 22.18).
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`gentle-accounts needs Node 22.18 or newer (found ${process.versions.node}).`);
  process.exit(1);
}

const { ProfileStore } = await import("../src/store.ts");
const { runCli } = await import("../src/cli.ts");

// Same resolution as gentle-shell: GENTLE_SHELL_HOME, else ~/.gentle-shell/agent.
const agentDir = process.env.PI_CODING_AGENT_DIR || process.env.GENTLE_SHELL_HOME || join(homedir(), ".gentle-shell", "agent");

const code = await runCli(process.argv.slice(2), {
  store: new ProfileStore(agentDir),
  liveAuthPath: join(agentDir, "auth.json"),
  env: process.env,
  platform: process.platform,
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  // Best effort if the launcher dies abruptly; the normal path finishes the session home itself.
  onExit: (cleanup) => process.on("exit", cleanup),
  // Asynchronous spawn (spawnSync blocks signal handlers): while the child runs, SIGINT is left to the
  // child (same terminal group) and SIGTERM/SIGHUP are forwarded; the result arrives on "close".
  spawn: ({ command, args, env, shell, onSpawn }) =>
    new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        for (const [signal, handler] of handlers) process.off(signal, handler);
        resolve(value);
      };
      // The handlers go in BEFORE the spawn and the (synchronous) marker write in onSpawn: a signal that
      // arrives in that window is queued by Node and forwarded once the child exists, instead of killing
      // the launcher by default and orphaning gentle-shell.
      let child;
      const handlers = [
        ["SIGINT", () => {}],
        ["SIGTERM", () => child?.kill("SIGTERM")],
        ["SIGHUP", () => child?.kill("SIGHUP")],
      ];
      for (const [signal, handler] of handlers) process.on(signal, handler);
      child = spawn(command, args, { stdio: "inherit", env, shell });
      if (child.pid !== undefined) onSpawn?.(child.pid);
      child.on("error", (error) => {
        console.error(`Cannot run ${command}: ${error.message}`);
        settle(1);
      });
      child.on("close", (status, signal) => {
        const signals = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
        settle(status ?? (signal ? 128 + (signals[signal] ?? 0) : 1));
      });
    }),
});
process.exit(code);
