// The one contract between the extension (palettes, views, the bar item)
// and whatever talks to an Apple TV: the real driver (device.ts, Companion
// plus MRP over AirPlay) and the fake one the tests and the fixture use
// (fake.ts). Everything the UI knows about a box comes through here.

/** An Apple TV seen on the network (mDNS: `_companion-link._tcp` and `_airplay._tcp`). */
export type Found = {
  /** Stable across address changes: the AirPlay `deviceid` (or the Companion `rpMRtID` when AirPlay is absent). */
  id: string;
  name: string;
  address: string;
  /** `AppleTV11,1`. */
  model: string;
  /** `AppleTV11,1` as people say it: "Apple TV 4K (2nd generation)". */
  modelName: string;
  /** tvOS version, `26.6`, when advertised. */
  os?: string;
  companionPort?: number;
  airplayPort?: number;
  /** The box answers mDNS through a sleep proxy: asleep, woken by connecting. */
  asleep?: boolean;
};

/** Long-term keys from one pairing (HAP pair-setup), hex strings so they sit in storage as JSON. */
export type Credentials = { clientId: string; clientLTSK: string; clientLTPK: string; serverLTPK: string; serverId: string };

/** A paired Apple TV as storage keeps it. */
export type Paired = {
  id: string;
  name: string;
  address: string;
  model: string;
  modelName: string;
  companionPort?: number;
  airplayPort?: number;
  companion?: Credentials;
  airplay?: Credentials;
  pairedAt: number;
};

export type PairProtocol = "companion" | "airplay";

/** A pairing in progress: the PIN is on the TV's screen until `finish` or `cancel`. */
export interface Pairing {
  finish(pin: string): Promise<Credentials>;
  cancel(): void;
}

/** Remote buttons. Companion HID where it has one, else MRP. */
export type Key =
  | "up" | "down" | "left" | "right" | "select" | "menu" | "home" | "play_pause"
  | "volume_up" | "volume_down" | "sleep" | "wake" | "screensaver"
  | "channel_up" | "channel_down" | "guide" | "page_up" | "page_down" | "siri";

/** How a button is pressed: a tap, two taps, or held (Home held is Control Center, Select held a context menu). */
export type Press = "tap" | "double" | "hold";

export type Swipe = "up" | "down" | "left" | "right";

/** MRP transport commands (Command in node-appletv-remote's supported-command). */
export type MediaCommand =
  | "play" | "pause" | "toggle" | "stop" | "next" | "previous"
  | "skip_forward" | "skip_backward" | "seek" | "shuffle" | "repeat"
  | "like" | "dislike" | "next_chapter" | "previous_chapter";

export type Power = "on" | "off" | "screensaver" | "unknown";

export type PlaybackState = "playing" | "paused" | "stopped" | "seeking" | "idle";

export type NowPlaying = {
  state: PlaybackState;
  title?: string;
  artist?: string;
  album?: string;
  /** Series, season and episode for TV shows when the app says. */
  series?: string;
  season?: number;
  episode?: number;
  /** "music" | "video" | "tv" | "podcast" ... as MRP's mediaType says, else undefined. */
  mediaType?: string;
  genre?: string;
  /** Seconds. */
  duration?: number;
  /** Seconds at `at` (unix ms); the UI moves it on with `rate`. */
  position?: number;
  at?: number;
  rate?: number;
  app?: { id: string; name?: string };
  shuffle?: "off" | "songs" | "albums";
  repeat?: "off" | "one" | "all";
  /** A stable id for the item playing (MRP contentItem identifier), so artwork and keys know when it changed. */
  itemId?: string;
  artworkAvailable?: boolean;
  /** The MediaCommands the app offers now; absent = unknown, assume the basics. */
  commands?: MediaCommand[];
};

export type App = { id: string; name: string };
export type Account = { id: string; name: string; current?: boolean };

/** The keyboard the TV is showing, when a text field has focus. */
export type Keyboard = { focused: boolean; title?: string; prompt?: string; text?: string; secure?: boolean };

/** What changed; the extension re-reads `Conn` getters and redraws. */
export type ChangeEvent =
  | { kind: "now_playing" }
  | { kind: "power" }
  | { kind: "volume" }
  | { kind: "keyboard" }
  | { kind: "connection"; up: boolean; error?: string };

/** One live session with one paired Apple TV (Companion, plus MRP when AirPlay is paired). */
export interface Conn {
  readonly device: Paired;
  /** Both channels up; MRP may be down while Companion is up (no AirPlay pairing, or it dropped). */
  readonly companionUp: boolean;
  readonly mrpUp: boolean;

  key(key: Key, press?: Press): Promise<void>;
  swipe(direction: Swipe): Promise<void>;
  /** A tap at a point of the touch surface, 0..1000 each. */
  touch(x: number, y: number): Promise<void>;

  media(command: MediaCommand, arg?: number): Promise<void>;
  nowPlaying(): NowPlaying | undefined;
  /** The cover of what plays, PNG or JPEG bytes, or null when the app gives none. */
  artwork(width: number, height: number): Promise<Uint8Array | null>;

  power(): Power;
  turnOn(): Promise<void>;
  turnOff(): Promise<void>;

  /** 0..1, or undefined when the TV does not report it (no CEC/eARC volume control). */
  volume(): number | undefined;
  setVolume(level: number): Promise<void>;

  apps(): Promise<App[]>;
  launch(bundleIdOrUrl: string): Promise<void>;
  accounts(): Promise<Account[]>;
  switchAccount(id: string): Promise<void>;

  keyboard(): Keyboard;
  /** Replace the focused field's text (clear + insert). */
  setText(text: string): Promise<void>;
  appendText(text: string): Promise<void>;
  clearText(): Promise<void>;

  on(listener: (e: ChangeEvent) => void): () => void;
  close(): Promise<void>;
}

/** The whole outside world, swapped for a fake in tests. */
export interface Driver {
  scan(timeoutMs: number): Promise<Found[]>;
  /** Shows a PIN on the TV's screen. */
  pair(found: Found, protocol: PairProtocol): Promise<Pairing>;
  connect(device: Paired): Promise<Conn>;
  /** An app's icon for a bundle id, as an https url, or undefined (the App Store's lookup). */
  appIcon(bundleId: string): Promise<string | undefined>;
}
