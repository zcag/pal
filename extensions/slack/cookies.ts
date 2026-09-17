// Chromium's cookie jar, read for one cookie: an SQLite file whose values
// are AES-128-CBC under a key derived (PBKDF2-SHA1 over the salt
// "saltysalt") from a password the OS keeps: the "Slack Safe Storage" item
// in the login keychain on macOS (1003 iterations), the Secret Service
// entry on Linux or, without a keyring, the constant "peanuts" (1
// iteration, what Chromium calls the v10 basic key). The value starts with
// "v10" (or "v11" on Linux for the keyring key), is PKCS#7 padded, and since
// Chromium 130 carries a 32-byte SHA-256 of the host key in front of the
// text. Nothing here writes: the jar is copied first, since the app holds
// it open and writes under us.
import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "@zcag/pal";

const SALT = "saltysalt";
const IV = Buffer.alloc(16, 0x20);
const KEY_BYTES = 16;

/** The AES key for a Chromium password: 1003 rounds on macOS, 1 on Linux. */
export const derive = (password: string | Uint8Array, iterations: number) => pbkdf2Sync(password, SALT, iterations, KEY_BYTES, "sha1");

/** One encrypted cookie value to its text; `host` strips the hash prefix newer Chromium puts in front. */
export function decrypt(value: Uint8Array, key: Buffer): string {
  const prefix = new TextDecoder("latin1").decode(value.subarray(0, 3));
  if (prefix !== "v10" && prefix !== "v11") throw new Error(`cookie: unknown encryption prefix ${JSON.stringify(prefix)}`);
  const d = createDecipheriv("aes-128-cbc", key, IV);
  const plain = Buffer.concat([d.update(value.subarray(3)), d.final()]);
  // Chromium >= 130 prefixes SHA-256(host_key); the text after it is ASCII, the hash is not.
  const text = plain.toString("utf8");
  return /^[\x20-\x7e]*$/.test(text) ? text : plain.subarray(32).toString("utf8");
}

/** Encrypts as Chromium would (the tests build a jar with it): `v10` + AES-128-CBC of `hash` + text, PKCS#7 padded. */
export function encrypt(text: string, key: Buffer, hostHash?: Uint8Array): Buffer {
  const c = createCipheriv("aes-128-cbc", key, IV);
  const body = Buffer.concat([...(hostHash ? [hostHash] : []), Buffer.from(text, "utf8")]);
  return Buffer.concat([Buffer.from("v10"), c.update(body), c.final()]);
}

/** The raw `encrypted_value` of one cookie out of a copy of the jar, or undefined when there is none. */
export function encryptedCookie(jar: string, host: string, name: string): Uint8Array | undefined {
  const dir = mkdtempSync(join(tmpdir(), "pal-slack-"));
  try {
    const copy = join(dir, "Cookies");
    copyFileSync(jar, copy);
    const db = new Database(copy, { readonly: true });
    try {
      const row = db.query<{ encrypted_value: Uint8Array }, [string, string]>("select encrypted_value from cookies where host_key = ? and name = ?").get(host, name);
      return row?.encrypted_value ? new Uint8Array(row.encrypted_value) : undefined;
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Runs a command to completion (or `ms`); stdout trimmed, or undefined on failure. */
export async function run(argv: string[], ms = 10_000): Promise<string | undefined> {
  const r = await exec(argv, { ms });
  return r.code === 0 ? r.out.trim() : undefined;
}

/**
 * The cookie's key on this machine for a value with the given prefix: macOS
 * asks the login keychain for the app's Safe Storage password (the one
 * call that can prompt, once; "Always Allow" ends that); Linux asks the
 * Secret Service (`secret-tool`, the `application` attribute Chromium and
 * Electron store under) for a `v11` value and uses "peanuts" for a `v10`.
 */
export async function keyFor(prefix: string, service: string, application: string): Promise<Buffer> {
  if (process.platform === "darwin") {
    const password = await run(["security", "find-generic-password", "-s", service, "-w"]);
    if (!password) throw new Error(`no "${service}" password in the keychain`);
    return derive(password, 1003);
  }
  if (prefix === "v11") {
    const password = (await run(["secret-tool", "lookup", "application", application])) ?? (await run(["secret-tool", "lookup", "application", application.toLowerCase()]));
    if (!password) throw new Error(`no "${application}" password in the Secret Service`);
    return derive(password, 1);
  }
  return derive("peanuts", 1);
}
