// Types for extension-repos.mjs, which node, bun, Vite and TypeScript all import.
export type Repo = { dir: string; shots: string; tests: string };
export const PAL: string;
export const SIBLINGS: string[];
export function extensionRepos(env?: Record<string, string | undefined>): Repo[];
export function extensionDirs(repos?: Repo[]): Map<string, { dir: string; repo: Repo }>;
export function extensionDir(name: string, repos?: Repo[]): string | undefined;
export function bundledNames(): string[];
export function bundledTests(repos?: Repo[]): string[];
