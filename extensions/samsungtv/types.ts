// The one contract between the extension (palettes, views, the bar item)
// and whatever talks to a Samsung TV: the real driver (device.ts: the
// remote websocket, the REST api on 8001, UPnP on 9197, Wake-on-LAN) and
// the fake one the tests and the fixture use (fake.ts). Only current
// Tizen TVs (2016 on, token auth); nothing here knows an older protocol.

/** A Samsung TV seen on the network (SSDP, then its `/api/v2/` answer). */
export type Found = {
  /** Stable across address changes: the TV's `duid` (`uuid:…`). */
  id: string;
  /** As the TV names itself, entities decoded: `75" Neo QLED`. */
  name: string;
  address: string;
  /** `QE75QN85DBTXTK`. */
  model: string;
  /** Wi-Fi or wired MAC, `F4:DD:06:41:3A:4C`: what Wake-on-LAN needs. */
  mac?: string;
  power: Power;
  /** The TV says it takes tokens (`TokenAuthSupport`); every TV this extension supports does. */
  tokenAuth: boolean;
  /** `FrameTVSupport`. */
  frame?: boolean;
};

/** A paired TV as storage keeps it: the token is what the TV gave when Allow was pressed. */
export type Paired = { id: string; name: string; address: string; model: string; mac?: string; token: string; pairedAt: number };

/**
 * `on`: the screen is on. `standby`: the TV answers on the network with
 * the screen off (network standby; `KEY_POWER` or Wake-on-LAN brings it
 * back). `off`: nothing answers. `unknown`: not asked yet.
 */
export type Power = "on" | "standby" | "off" | "unknown";

/** Remote buttons, as the UI names them; `KEYS` maps each to the TV's `KEY_*` code. */
export type Key =
  | "up" | "down" | "left" | "right" | "select" | "back" | "home" | "menu" | "exit"
  | "play" | "pause" | "play_pause" | "stop" | "rewind" | "forward" | "previous" | "next"
  | "volume_up" | "volume_down" | "mute" | "power"
  | "channel_up" | "channel_down" | "channel_list" | "guide" | "info" | "tools"
  | "source" | "hdmi" | "tv" | "hdmi1" | "hdmi2" | "hdmi3" | "hdmi4"
  | "red" | "green" | "yellow" | "blue"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** `Click` a key, or hold it: `Press` then `Release` after `holdMs`. */
export type Press = "tap" | "hold";

/** An input key (device.ts `INPUTS`). `sure`: seen working on a current TV; the numbered HDMI keys did nothing on a 2024 one. */
export type Input = { id: "tv" | "hdmi" | "hdmi1" | "hdmi2" | "hdmi3" | "hdmi4" | "source"; name: string; sure: boolean };

/** An installed app. `type` is the TV's `app_type` (2 web app, 4 native), which picks how it is launched. */
export type App = { id: string; name: string; type?: number; icon?: string };

/** One app's state as the REST api tells it: installed (a 404 is not), running, in front. */
export type AppState = { id: string; name: string; running: boolean; visible: boolean };

/** What the TV renders for a DLNA sender (UPnP AVTransport); nothing about what an app plays. */
export type Media = { state: "playing" | "paused" | "stopped" | "transitioning" | "idle"; title?: string; url?: string; position?: number; duration?: number; at: number };

/** The on-screen keyboard: open while a text field has focus (`ms.remote.imeStart` … `imeEnd`). */
export type Keyboard = { open: boolean; text?: string };

/** What changed; the extension re-reads `Conn` getters and redraws. `token`: the TV issued a new one, store it. */
export type ChangeEvent =
  | { kind: "power" }
  | { kind: "volume" }
  | { kind: "app" }
  | { kind: "media" }
  | { kind: "keyboard" }
  | { kind: "token"; token: string }
  | { kind: "connection"; up: boolean; error?: string };

/** One live session with one paired TV: the remote websocket when the screen is on, REST and UPnP polled. */
export interface Conn {
  readonly device: Paired;
  /** The token in use: the TV may hand out a new one on any connect (`token` events say so later); store it when it differs from `device.token`. */
  readonly token: string;
  /** The remote websocket is open (keys, text, apps, launch); REST and UPnP work without it. */
  readonly remoteUp: boolean;

  key(key: Key, press?: Press): Promise<void>;
  /** A raw `KEY_*` code, for what `Key` does not name. */
  rawKey(code: string, press?: Press): Promise<void>;
  /** Move the pointer by a delta and click (the touchpad remotes' cursor); only some apps show it. */
  pointer(dx: number, dy: number): Promise<void>;
  click(): Promise<void>;

  power(): Power;
  turnOn(): Promise<void>;
  turnOff(): Promise<void>;

  /** 0..100 as the TV counts it, undefined until read. */
  volume(): number | undefined;
  setVolume(level: number): Promise<void>;
  muted(): boolean | undefined;
  setMuted(muted: boolean): Promise<void>;

  inputs(): Input[];
  setInput(id: Input["id"]): Promise<void>;

  /** The installed apps (`ed.installedApp.get`), else the known catalog checked one by one over REST. */
  apps(): Promise<App[]>;
  /** The app in front, when one is (REST `visible`), from the apps last listed. */
  foreground(): AppState | undefined;
  /** Open an app (REST: the websocket's launch opened nothing on a 2024 TV, and no deep link did). */
  launch(id: string): Promise<void>;
  quit(id: string): Promise<void>;
  /** An app's icon, PNG/JPEG bytes from the TV, or null. */
  icon(app: App): Promise<Uint8Array | null>;

  media(): Media | undefined;

  keyboard(): Keyboard;
  /** Send text to the focused field (the TV appends it), then end the input when `done`. */
  type(text: string, done?: boolean): Promise<void>;

  on(listener: (e: ChangeEvent) => void): () => void;
  close(): Promise<void>;
}

/** A pairing in progress: the TV shows "Allow pal?" until someone presses Allow (or Deny, or it times out). */
export interface Pairing {
  /** The token once Allow is pressed; refused with the TV's reason. */
  readonly token: Promise<string>;
  cancel(): void;
}

/** The whole outside world, swapped for a fake in tests. */
export interface Driver {
  scan(timeoutMs: number): Promise<Found[]>;
  /** One TV by address: its `/api/v2/` answer, or undefined when nothing answers there. */
  probe(address: string): Promise<Found | undefined>;
  pair(found: Found): Promise<Pairing>;
  connect(device: Paired): Promise<Conn>;
  /** Wake-on-LAN, with no connection: what turns a TV on from off. */
  wake(device: Pick<Paired, "address" | "mac">): Promise<void>;
}
