import { lstatSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

/** True when `path` is a symbolic link (a dangling one included); false for a file, a directory or a missing path. */
export function isAuthLinked(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Where a write to `path` really lands: the link target when `path` is a symlink (followed through
 * chains), `path` itself otherwise. A write-then-rename on the link would replace it by a regular file.
 */
export function resolveAuthTarget(path: string): string {
  let current = path;
  for (let hops = 0; hops < 8 && isAuthLinked(current); hops++) current = resolve(dirname(current), readlinkSync(current));
  return current;
}

/**
 * Makes `linkPath` a symlink to `target`, replacing an existing link atomically (the link is built next
 * to it and renamed over it), so a reader never sees the path missing. Neither the old nor the new
 * target is touched. POSIX only: Windows keeps the copy model.
 */
export function pointAuthAt(linkPath: string, target: string): void {
  const tmp = `${linkPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  symlinkSync(target, tmp);
  try {
    renameSync(tmp, linkPath);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
