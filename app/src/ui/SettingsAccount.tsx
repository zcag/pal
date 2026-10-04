import { useEffect, useState } from "react";
import { relativeDate } from "./format";
import { ArmedButton, SettingsGroup, SettingsRow } from "./SettingsField";
import type { SettingsIndexEntry } from "./SettingsTypes";

/** account.rs `AccountView`. */
export type AccountState = {
  signedIn: boolean;
  email?: string | null;
  handle?: string | null;
  /** Unix seconds of the last sync that went through. */
  lastSynced?: number | null;
  /** The loaded extensions that sync their storage. */
  synced: { key: string; title: string }[];
};

/** One device in `GET /api/account` (times unix seconds). */
export type AccountDevice = { id: string; name: string; created: number; last_seen: number; current: boolean };

/** One revision in `GET /api/sync/history` (times unix seconds). */
export type SyncRev = { key: string; value: unknown; rev: number; at: number; device: string };

/** Where a restore goes: one key to a revision, or a whole space to a time. */
export type RestoreTarget = { key: string; rev: number } | { at: number };

export type SettingsAccountProps = {
  state: AccountState;
  /** Mails a code to the address. */
  onStart: (email: string) => Promise<void>;
  /** The code from the mail: signed in, this Mac's settings and progress merged with the account's. */
  onVerify: (email: string, code: string) => Promise<void>;
  /** The devices (and the email and handle refreshed). */
  onDevices: () => Promise<AccountDevice[]>;
  onHandle: (handle: string) => Promise<string>;
  onDropDevice: (id: string, current: boolean) => Promise<void>;
  onSyncNow: () => Promise<void>;
  /** A space's revisions (`config`, `ext:<key>`), newest first. */
  onHistory: (space: string) => Promise<SyncRev[]>;
  onRestore: (space: string, target: RestoreTarget) => Promise<void>;
  onSignOut: () => Promise<void>;
  onDelete: () => Promise<void>;
  /** The clock the relative times read (tests pin it). */
  now?: number;
};

export const accountIndex: SettingsIndexEntry[] = [
  { page: "account", label: "Sign in", hint: "Account", anchor: "account:email", keywords: "account email code login sync backup" },
  { page: "account", label: "Handle", hint: "Account", anchor: "account:handle", keywords: "name leaderboard scores username" },
  { page: "account", label: "Sync now", hint: "Account", anchor: "account:sync", keywords: "sync last synced backup machines" },
  { page: "account", label: "Devices", hint: "Account", anchor: "account:devices", keywords: "sign out machines computers" },
  { page: "account", label: "Settings history", hint: "Account", anchor: "account:history", keywords: "restore backup versions undo" },
  { page: "account", label: "Delete account", hint: "Account", anchor: "account:delete", keywords: "remove erase data" },
];

const ago = (secs: number, now: number) => {
  const r = relativeDate(secs * 1000, now);
  return r === "now" ? "just now" : `${r} ago`;
};

/** A stored value in a few words: a number or a word as itself, a list or an object by its size. */
export function summary(v: unknown): string {
  if (v === null || v === undefined) return "removed";
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  if (typeof v === "object") return `${Object.keys(v as object).length} fields`;
  const s = String(v);
  return s.length > 32 ? `${s.slice(0, 31)}…` : s;
}

/** Revisions by local day, newest first: each day's newest time is what "Restore these settings" goes back to. */
export function byDay(revs: SyncRev[]): { day: string; at: number; keys: number; devices: string[] }[] {
  const days = new Map<string, { day: string; at: number; keys: Set<string>; devices: Set<string> }>();
  for (const r of revs) {
    const d = new Date(r.at * 1000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const e = days.get(day) ?? { day, at: 0, keys: new Set(), devices: new Set() };
    e.at = Math.max(e.at, r.at);
    e.keys.add(r.key);
    if (r.device) e.devices.add(r.device);
    days.set(day, e);
  }
  return [...days.values()].sort((a, b) => b.at - a.at).map((e) => ({ day: e.day, at: e.at, keys: e.keys.size, devices: [...e.devices] }));
}

const dayTitle = (at: number) => new Date(at * 1000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** One busy flag and the last error, for a row's buttons. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: string, f: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try { await f(); return true; } catch (e) { setError(String(e)); return false; } finally { setBusy(null); }
  };
  return { busy, error, run, setError };
}

/** Signed out: the email, then the code. */
function SignIn({ onStart, onVerify }: Pick<SettingsAccountProps, "onStart" | "onVerify">) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, run } = useAction();
  const start = () => { const e = email.trim(); if (e.includes("@")) run("start", () => onStart(e)).then((ok) => { if (ok) setSent(e); }); };
  const verify = () => { if (sent && code.trim()) run("verify", () => onVerify(sent, code.trim())); };
  return (
    <SettingsGroup title="Account">
      {!sent ? (
        <SettingsRow anchor="account:email" label="Email" htmlFor="pal-account-email" description={<>{error ? <span data-error>{error} </span> : null}Sign in to keep your settings, installed extensions and game progress the same on every Mac and on play.cagdas.io, and to put your scores on leaderboards. No password: a code comes by mail.</>}>
          <input id="pal-account-email" className="pal-field__input" type="email" autoComplete="email" placeholder="you@example.com" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") start(); }} />
          <button type="button" className="pal-button" data-primary="" disabled={!email.includes("@") || busy !== null} onClick={start}>{busy ? "Sending…" : "Send Code"}</button>
        </SettingsRow>
      ) : (
        <SettingsRow anchor="account:email" label="Code" htmlFor="pal-account-code" description={<>{error ? <span data-error>{error} </span> : null}Sent to {sent}; it works for 10 minutes. <button type="button" className="pal-link" onClick={() => run("start", () => onStart(sent))}>Send again</button> · <button type="button" className="pal-link" onClick={() => { setSent(null); setCode(""); }}>Use another email</button></>}>
          <input id="pal-account-code" className="pal-field__input pal-account__code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") verify(); }} />
          <button type="button" className="pal-button" data-primary="" disabled={code.length < 6 || busy !== null} onClick={verify}>{busy === "verify" ? "Signing In…" : "Sign In"}</button>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

/** The handle: typed, saved on Enter or Save; the server says what is wrong with one. */
function Handle({ value, onHandle }: { value?: string | null; onHandle: SettingsAccountProps["onHandle"] }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const { busy, error, run } = useAction();
  const changed = draft.trim() !== "" && draft.trim().toLowerCase() !== (value ?? "").toLowerCase();
  const save = () => { if (changed) run("handle", () => onHandle(draft.trim())); };
  return (
    <SettingsRow anchor="account:handle" label="Handle" htmlFor="pal-account-handle" description={<>{error ? <span data-error>{error} </span> : null}{value ? "What leaderboards show; your email never is." : "Leaderboards show a handle, never your email: choose one before your first score goes up."} 3 to 20 letters, digits, - and _.</>}>
      <input id="pal-account-handle" className="pal-field__input pal-account__handle" type="text" autoComplete="off" spellCheck={false} placeholder="your-name" maxLength={20} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setDraft(value ?? ""); }} />
      {changed && <button type="button" className="pal-button" data-small disabled={busy !== null} onClick={save}>{busy ? "Saving…" : "Save"}</button>}
    </SettingsRow>
  );
}

/** A synced extension's keys and their revisions, loaded when asked for. */
function ExtensionHistory({ ext, onHistory, onRestore, now }: { ext: { key: string; title: string }; onHistory: SettingsAccountProps["onHistory"]; onRestore: SettingsAccountProps["onRestore"]; now: number }) {
  const space = `ext:${ext.key}`;
  const [revs, setRevs] = useState<SyncRev[] | null>(null);
  const { busy, error, run } = useAction();
  const load = () => run("load", async () => setRevs(await onHistory(space)));
  const keys = revs ? [...new Set(revs.map((r) => r.key))] : [];
  return (
    <SettingsRow label={ext.title} description={error ? <span data-error>{error}</span> : revs && !keys.length ? "Nothing synced yet." : undefined}>
      {!revs ? (
        <button type="button" className="pal-button" data-small disabled={busy !== null} onClick={load}>{busy ? "Loading…" : "Show History"}</button>
      ) : (
        <ul className="pal-account__history">
          {keys.map((k) => {
            const list = revs.filter((r) => r.key === k).sort((a, b) => b.rev - a.rev).slice(0, 5);
            return (
              <li key={k} className="pal-account__key">
                <code className="pal-account__name">{k}</code>
                <ul className="pal-account__revs">
                  {list.map((r, i) => (
                    <li key={r.rev} className="pal-account__rev">
                      <span className="pal-account__value">{summary(r.value)}</span>
                      <span className="pal-account__when">{ago(r.at, now)}{r.device ? `, ${r.device}` : ""}</span>
                      {i === 0 ? <span className="pal-account__now">now</span> : <button type="button" className="pal-button" data-small disabled={busy !== null} onClick={() => run("restore", async () => { await onRestore(space, { key: k, rev: r.rev }); setRevs(await onHistory(space)); })}>Restore</button>}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsRow>
  );
}

/** Signed in: who, the handle, sync, the devices, the history, sign out and delete. */
function SignedIn(p: SettingsAccountProps) {
  const now = p.now ?? Date.now();
  const { state } = p;
  const [devices, setDevices] = useState<AccountDevice[] | null>(null);
  const [days, setDays] = useState<ReturnType<typeof byDay> | null>(null);
  const [more, setMore] = useState(false);
  const sync = useAction();
  const dev = useAction();
  const hist = useAction();
  const leave = useAction();
  useEffect(() => {
    dev.run("load", async () => setDevices(await p.onDevices()));
    hist.run("load", async () => setDays(byDay(await p.onHistory("config"))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shownDays = days ? (more ? days : days.slice(0, 7)) : [];
  return (
    <>
      <SettingsGroup title="Account">
        <SettingsRow anchor="account:email" label="Email">
          <span className="pal-account__email">{state.email}</span>
        </SettingsRow>
        <Handle value={state.handle} onHandle={p.onHandle} />
        <SettingsRow anchor="account:sync" label="Sync" description={<>{sync.error ? <span data-error>{sync.error} </span> : null}Settings, installed extensions and the progress of games that sync, merged so nothing is lost. Hotkeys, where the bar draws and folders stay on each Mac.</>}>
          <span className="pal-about__row">
            <span>{state.lastSynced ? `Last synced ${ago(state.lastSynced, now)}` : "Not synced yet"}</span>
            <button type="button" className="pal-button" data-small disabled={sync.busy !== null} onClick={() => sync.run("sync", p.onSyncNow)}>{sync.busy ? "Syncing…" : "Sync Now"}</button>
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Devices">
          {dev.error && <SettingsRow label="Devices" description={<span data-error>{dev.error}</span>}>{null}</SettingsRow>}
          {!devices && !dev.error && <SettingsRow label="Devices">Loading…</SettingsRow>}
          {devices?.map((d, i) => (
            <SettingsRow key={d.id} anchor={i === 0 ? "account:devices" : undefined} label={d.name} description={`Signed in ${ago(d.created, now)}, last seen ${ago(d.last_seen, now)}.`}>
              {d.current ? <span className="pal-account__now">This Mac</span> : <button type="button" className="pal-button" data-small disabled={dev.busy !== null} onClick={() => dev.run(d.id, async () => { await p.onDropDevice(d.id, false); setDevices((ds) => ds?.filter((x) => x.id !== d.id) ?? null); })}>{dev.busy === d.id ? "Signing Out…" : "Sign Out"}</button>}
            </SettingsRow>
          ))}
      </SettingsGroup>

      <SettingsGroup title="History">
          <SettingsRow anchor="account:history" label="Settings" description={hist.error ? <span data-error>{hist.error}</span> : days && !days.length ? "Nothing synced yet." : "Every version is kept; putting back a day's settings is itself a change you can undo."}>
            {days === null && !hist.error && <span className="pal-account__when">Loading…</span>}
            {days && days.length > 0 && (
              <ul className="pal-account__days">
                {shownDays.map((d, i) => (
                  <li key={d.day} className="pal-account__day">
                    <span className="pal-account__name">{dayTitle(d.at)}</span>
                    <span className="pal-account__when">{d.keys} {d.keys === 1 ? "change" : "changes"}{d.devices.length ? `, ${d.devices.join(", ")}` : ""}</span>
                    {i === 0 ? <span className="pal-account__now">now</span> : <button type="button" className="pal-button" data-small disabled={hist.busy !== null} onClick={() => hist.run(d.day, async () => { await p.onRestore("config", { at: d.at }); setDays(byDay(await p.onHistory("config"))); })}>{hist.busy === d.day ? "Restoring…" : "Restore These Settings"}</button>}
                  </li>
                ))}
                {days.length > 7 && <li><button type="button" className="pal-link" onClick={() => setMore(!more)}>{more ? "Fewer days" : `${days.length - 7} older days`}</button></li>}
              </ul>
            )}
          </SettingsRow>
          {state.synced.map((e) => <ExtensionHistory key={e.key} ext={e} onHistory={p.onHistory} onRestore={p.onRestore} now={now} />)}
      </SettingsGroup>

      <SettingsGroup title="Signing out">
        <SettingsRow label="Sign out" description={<>{leave.error ? <span data-error>{leave.error} </span> : null}This Mac stops syncing; what is on it stays.</>}>
          <button type="button" className="pal-button" data-small disabled={leave.busy !== null} onClick={() => leave.run("out", p.onSignOut)}>Sign Out</button>
        </SettingsRow>
        <SettingsRow anchor="account:delete" label="Delete account" description="Deletes everything the server keeps: settings and their history, game progress, scores, your handle and every device's sign-in. What is on this Mac stays.">
          <ArmedButton label="Delete Account" busy={leave.busy === "delete" ? "Deleting…" : undefined} arm="Delete everything? Click again" disabled={leave.busy !== null} onConfirm={() => leave.run("delete", p.onDelete)} data-small />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

/** Settings › Account: signing in with an email and a code, and once in, the account, its devices and its history. */
export function SettingsAccount(props: SettingsAccountProps) {
  return <div className="pal-settings-page pal-account">{props.state.signedIn ? <SignedIn {...props} /> : <SignIn onStart={props.onStart} onVerify={props.onVerify} />}</div>;
}
