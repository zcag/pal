// File operations a row can do (Files, Downloads): the rename, move and
// copy forms and their submits, the archive command. The forms are pure;
// the submits touch the file system (rename across volumes falls to `mv`,
// a copy is `fs.cp`), and every refusal is the form again with the
// message under the field, the typed value kept. `files` on `@zcag/pal`.
import { cp, mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { home, tilde } from "./api.ts";
import { EXEC_MS, run } from "./exec.ts";
import type { Effect, Form, FormValues } from "./protocol.ts";

const MAC = process.platform === "darwin";

const exists = (p: string) => stat(p).then(() => true).catch(() => false);

// ---- forms --------------------------------------------------------------------

export const renameForm = (path: string, errors?: Form["errors"]): Form => ({
  id: path, title: "Rename", fields: [{ kind: "text", id: "name", label: "Name", default: basename(path), required: true, description: "The new name, in the same folder; the extension is part of it." }], submit: { id: "rename-submit", title: "Rename" }, errors,
});
export const moveForm = (path: string, errors?: Form["errors"]): Form => ({
  id: path, title: `Move ${basename(path)}`, fields: [{ kind: "text", id: "folder", label: "Folder", placeholder: "~/Documents", default: "~/Documents", required: true, description: "Where it goes; ~ is expanded, a missing folder is created." }], submit: { id: "move-submit", title: "Move" }, errors,
});
export const copyForm = (path: string, errors?: Form["errors"]): Form => ({
  id: path, title: `Copy ${basename(path)}`, fields: [{ kind: "text", id: "folder", label: "Folder", placeholder: "~/Documents", default: "~/Documents", required: true, description: "Where the copy goes, under the same name; ~ is expanded, a missing folder is created." }], submit: { id: "copy-submit", title: "Copy" }, errors,
});

// ---- the operations ---------------------------------------------------------

/** `path` becomes `target`, which must not exist; across volumes `rename` fails and `mv` does it. */
export async function moveTo(path: string, target: string): Promise<void> {
  if (await exists(target)) throw new Error(`${tilde(target)} exists already`);
  try { await rename(path, target); } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "EXDEV") throw e;
    await run(["mv", "--", path, target]);
  }
}

/** A copy of `path` (a folder whole) at `target`, which must not exist. */
export async function copyTo(path: string, target: string): Promise<void> {
  if (await exists(target)) throw new Error(`${tilde(target)} exists already`);
  await cp(path, target, { recursive: true, errorOnExist: true, force: false });
}

/** The submit of `renameForm`: the same folder, the new name; a slash or a taken name is the form again. */
export async function renamePick(path: string, values: FormValues = {}): Promise<Effect> {
  const name = String(values.name ?? "").trim();
  if (!name || name.includes("/") || name === "." || name === "..") return { form: renameForm(path, { name: "A file name, without a slash" }) };
  const target = join(dirname(path), name);
  if (target === path) return { keep: true };
  try { await moveTo(path, target); } catch (e) { return { form: renameForm(path, { name: String((e as Error)?.message ?? e) }) }; }
  return { keep: true, toast: { title: "Renamed", message: name } };
}

/** The submit of `moveForm` or `copyForm`: into the folder (made when missing) under the same name. */
export async function intoFolderPick(op: "move" | "copy", path: string, values: FormValues = {}): Promise<Effect> {
  const form = op === "move" ? moveForm : copyForm;
  const folder = home(String(values.folder ?? "").trim());
  if (!folder) return { form: form(path, { folder: "A folder path" }) };
  try {
    await mkdir(folder, { recursive: true });
    await (op === "move" ? moveTo : copyTo)(path, join(folder, basename(path)));
  } catch (e) { return { form: form(path, { folder: String((e as Error)?.message ?? e) }) }; }
  return { keep: true, toast: { title: op === "move" ? "Moved" : "Copied", message: `${basename(path)} to ${tilde(folder)}` } };
}

// ---- archives -----------------------------------------------------------------

/** `<stem>.zip` next to `first` (`stem-2.zip` and on while taken). */
export async function archiveName(first: string): Promise<string> {
  const stem = join(dirname(first), basename(first).replace(/\.[^.]+$/, "") || basename(first));
  for (let n = 1; ; n++) {
    const p = n === 1 ? `${stem}.zip` : `${stem}-${n}.zip`;
    if (!(await exists(p))) return p;
  }
}

/**
 * The command that zips `paths` into `out`: `ditto` on macOS (resource
 * forks sequestered, each entry under its own name), `zip -r` on Linux
 * (run from the folder so the entries are relative); `PAL_FILES_ZIP` names
 * a stand-in taking `out` then the paths (the tests).
 */
export function archiveArgv(paths: string[], out: string, env: Record<string, string | undefined> = process.env): { argv: string[]; cwd?: string } {
  if (env.PAL_FILES_ZIP) return { argv: [env.PAL_FILES_ZIP, out, ...paths] };
  if (MAC) return { argv: ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", ...paths, out] };
  return { argv: ["zip", "-r", "-q", out, ...paths.map((p) => basename(p))], cwd: dirname(paths[0]) };
}

/** `paths` into one archive named after the first; the archive's path. */
export async function archive(paths: string[]): Promise<string> {
  const out = await archiveName(paths[0]);
  const { argv, cwd } = archiveArgv(paths, out);
  await run(argv, { cwd, ms: EXEC_MS * 6 });
  return out;
}
