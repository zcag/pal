// The package's identity, `pal-tree-v1` (docs/registry.md, "Packages"):
// the sha256 of one line per regular file, `<path>\0<x|->\0<sha256>\n`,
// sorted by the path's bytes, dotfiles skipped at any depth. Computed on
// the directory, never the tarball, so a bundled copy and a downloaded one
// of the same build hash alike. `pal_core::registry::tree_hash` is the
// Rust twin; both test against core/tests/fixtures/tree-hash.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";

/** One regular file of a package: its path from the package root (`/` separators), whether the owner may execute it, where it is. */
export type TreeFile = { path: string; exec: boolean; abs: string };
/** One directory under the package root (the root itself left out), for the tarball's directory entries. */
export type TreeDir = { path: string };

const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Every file and directory under `root`, dotfiles skipped, each list sorted by bytes; a symlink or anything but a file or a directory throws. */
export async function walk(root: string): Promise<{ files: TreeFile[]; dirs: TreeDir[] }> {
  const files: TreeFile[] = [];
  const dirs: TreeDir[] = [];
  const visit = async (rel: string) => {
    for (const name of await readdir(rel ? `${root}/${rel}` : root)) {
      if (name.startsWith(".")) continue;
      const path = rel ? `${rel}/${name}` : name;
      const abs = `${root}/${path}`;
      const st = await lstat(abs);
      if (st.isDirectory()) {
        dirs.push({ path });
        await visit(path);
      } else if (st.isFile()) files.push({ path, exec: (st.mode & 0o100) !== 0, abs });
      else throw new Error(`${abs}: not a regular file or a directory (a package holds nothing else)`);
    }
  };
  await visit("");
  files.sort((a, b) => byBytes(a.path, b.path));
  dirs.sort((a, b) => byBytes(a.path, b.path));
  return { files, dirs };
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** The `pal-tree-v1` hash of the directory `root`: lowercase hex. */
export async function treeHash(root: string): Promise<string> {
  const { files } = await walk(root);
  const lines = await Promise.all(files.map(async (f) => `${f.path}\0${f.exec ? "x" : "-"}\0${sha256(await readFile(f.abs))}\n`));
  return sha256(lines.join(""));
}
