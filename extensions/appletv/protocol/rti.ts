// The text a focused field on the Apple TV holds and edits to it: RTI
// (remote text input) payloads, NSKeyedArchiver binary plists. The two
// payloads are pyatv's `plist_payloads/rti_text_operations.py` (pre-encoded
// archives, object by object); reading follows UID references from
// `$top`, as pyatv's `keyed_archiver.read_archive_properties`.
import bplistCreator from "bplist-creator";
import bplistParser from "bplist-parser";

const uid = (n: number) => ({ UID: n });
const cls = (name: string) => ({ $classname: name, $classes: [name, "NSObject"] });
/** An RTI keyed archive: `$top`'s keys point (by UID) into `objects`, `{ UID: n }` being a reference. */
export const archive = (top: Record<string, unknown>, objects: unknown[]): Buffer => bplistCreator({ $version: 100000, $archiver: "RTIKeyedArchiver", $top: top, $objects: objects });
const operations = (objects: unknown[]) => archive({ textOperations: uid(1) }, objects);

/** Clears the field the session `uuid` (16 bytes) belongs to. */
export const clearPayload = (uuid: Uint8Array): Buffer => operations([
  "$null",
  { $class: uid(7), targetSessionUUID: uid(5), keyboardOutput: uid(2), textToAssert: uid(4) },
  { $class: uid(3) },
  cls("TIKeyboardOutput"),
  "",
  { "NS.uuidbytes": Buffer.from(uuid), $class: uid(6) },
  cls("NSUUID"),
  cls("RTITextOperations"),
]);

/** Inserts `text` at the caret of the session's field. */
export const insertPayload = (uuid: Uint8Array, text: string): Buffer => operations([
  "$null",
  { keyboardOutput: uid(2), $class: uid(7), targetSessionUUID: uid(5) },
  { insertionText: uid(3), $class: uid(4) },
  text,
  cls("TIKeyboardOutput"),
  { "NS.uuidbytes": Buffer.from(uuid), $class: uid(6) },
  cls("NSUUID"),
  cls("RTITextOperations"),
]);

type Archive = { $top: Record<string, unknown>; $objects: unknown[] };
const isUid = (v: unknown): v is { UID: number } => !!v && typeof v === "object" && typeof (v as { UID?: unknown }).UID === "number" && Object.keys(v).length === 1;

/** One value at `path` from `$top`, every UID on the way resolved; undefined when the path is not there. */
export function readArchive(data: Uint8Array, path: string[]): unknown {
  const [root] = bplistParser.parseBuffer(Buffer.from(data)) as Archive[];
  let at: unknown = root.$top;
  for (const key of path) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
    if (isUid(at)) at = root.$objects[at.UID];
  }
  return at;
}

/** What a `_tiStart` reply's `_tiD` says: the session to address edits to, and the text before the caret. */
export function readSession(tiD: Uint8Array): { uuid?: Uint8Array; text: string } {
  const uuid = readArchive(tiD, ["sessionUUID"]);
  const text = readArchive(tiD, ["documentState", "docSt", "contextBeforeInput"]);
  return { uuid: uuid instanceof Uint8Array ? uuid : undefined, text: typeof text === "string" ? text : "" };
}
