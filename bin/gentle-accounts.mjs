#!/usr/bin/env node
// Launcher: `gentle-accounts <name> [gentle-shell args...]`.
// Runs the TypeScript sources through Node's built-in type stripping (Node >= 22.18).
import { spawnSync } from "node:child_process";
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

const code = runCli(process.argv.slice(2), {
  store: new ProfileStore(agentDir),
  liveAuthPath: join(agentDir, "auth.json"),
  env: process.env,
  platform: process.platform,
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  spawn: ({ command, args, env, shell }) => {
    const result = spawnSync(command, args, { stdio: "inherit", env, shell });
    if (result.error) {
      console.error(`Cannot run ${command}: ${result.error.message}`);
      return 1;
    }
    return result.status ?? 1;
  },
});
process.exit(code);
