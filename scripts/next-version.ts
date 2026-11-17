// Computes the next release version from the latest vX.Y.Z tag and the
// squashed merge commit message (S21). Pure function plus a small CLI.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Types are case-sensitive lower case: `Feat:` is not conventional.
const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

export function nextVersion({ latestTag, message }: { latestTag: string | null; message: string }): string {
  if (latestTag === null) return "0.1.0";
  const tag = TAG.exec(latestTag);
  if (!tag) throw new Error(`next-version: malformed latest tag "${latestTag}", expected vMAJOR.MINOR.PATCH`);
  const [major, minor, patch] = [Number(tag[1]), Number(tag[2]), Number(tag[3])];

  // The subject is the first line; a trailing " (#123)" PR suffix is ignored.
  const subject = (message.split(/\r?\n/, 1)[0] ?? "").replace(/ \(#\d+\)\s*$/, "").trim();
  const cc = CONVENTIONAL.exec(subject);
  const type = cc && /^[a-z]+$/.test(cc[1]) ? cc[1] : null;
  const breaking = type !== null && (cc?.[3] === "!" || BREAKING_FOOTER.test(message));
  const feat = type === "feat";

  if (major === 0) {
    return breaking || feat ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`;
  }
  if (breaking) return `${major + 1}.0.0`;
  if (feat) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function latestReachableTag(): string | null {
  try {
    return git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]).trim() || null;
  } catch {
    return null; // no matching tag yet
  }
}

function main(): void {
  try {
    // A shallow clone hides older tags and would silently yield 0.1.0.
    if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
      throw new Error("next-version: shallow clone detected; fetch the full history and tags (checkout with fetch-depth: 0)");
    }
    const message = git(["log", "-1", "--format=%B", "HEAD"]);
    process.stdout.write(nextVersion({ latestTag: latestReachableTag(), message }) + "\n");
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    process.stderr.write((text.startsWith("next-version:") ? text : `next-version: ${text}`) + "\n");
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) main();
