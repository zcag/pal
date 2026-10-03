// The `node:*` modules the host and the SDK import, for the web build: the
// path helpers work, the file system is empty, and `AsyncLocalStorage` holds
// its store for the synchronous part of `run` only (a call after an await
// finds its extension on the stack instead, settings.ts `fromStack`).
const none = (what: string) => () => { throw new Error(`${what}: no file system on the web`); };

export const existsSync = () => false;
export const readdirSync = () => [];
export const readFileSync = none("readFileSync");
export const statSync = none("statSync");
export const appendFileSync = () => {};
export const realpathSync = (p: string) => p;
export const cp = () => Promise.reject(new Error("cp: no file system on the web"));
export const mkdir = cp, rename = cp, stat = cp, readFile = cp, writeFile = cp, readdir = cp, rm = cp;

export const join = (...p: string[]) => p.filter(Boolean).join("/").replace(/\/+/g, "/");
export const resolve = join;
export const dirname = (p: string) => p.replace(/\/[^/]*\/?$/, "") || "/";
export const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? "";
export const homedir = () => "/";

export class AsyncLocalStorage<T> {
  private store: T | undefined;
  getStore() { return this.store; }
  run<R>(store: T, f: () => R): R {
    const prev = this.store;
    this.store = store;
    try { return f(); } finally { this.store = prev; }
  }
}
