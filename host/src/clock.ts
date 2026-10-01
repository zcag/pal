// The tests' clock (host/test/README.md, Time): with PAL_TEST_CLOCK=1 this
// thread's timers are fake and move only when the test says so
// (`clock/advance`, host.ts; `{ advance }`, worker.ts), so a test of an 8 s
// timeout or a 1 Hz tick takes no real time and no tick lands late on a
// busy runner. host.ts and worker.ts await `ready` before they load an
// extension, so its modules see the fake globals. (Not a top-level await:
// a worker still inside one drops the messages posted to it meanwhile.)
//
// - A timer of 100 ms or more (`FROM`) fires only on an advance that
//   reaches it: a tick, a timeout, a debounce, a retry. A shorter one is
//   real: it orders work rather than waits for something.
// - `Date` and `performance.now` are the real time plus how far the clock
//   was advanced: timestamps from outside (a mock server, a stand-in tool,
//   a file's mtime) stay comparable, and an advance moves them forward.
// - `Bun.sleep` and `AbortSignal.timeout` are fake timers too.
//
// Without the variable nothing here runs: the shipped host never sets it.
import type { Clock } from "@sinonjs/fake-timers";

/** The shortest fake timer: under it a delay orders work (a push coalesced for 33 ms, a yield, a reload's 50 ms debounce) rather than waits, and stays real. */
const FROM = 100;

let clock: Clock | undefined;
let start = 0;

/** Settled once the fake globals are in place (at once without PAL_TEST_CLOCK). */
export const ready: Promise<void> = process.env.PAL_TEST_CLOCK ? install() : Promise.resolve();

async function install() {
  // Loaded only here: a dev dependency the shipped host (host/src as-is) never reaches.
  const FakeTimers = (await import("@sinonjs/fake-timers")).default;
  const real = { setTimeout, clearTimeout, setInterval, clearInterval, Date, now: performance.now.bind(performance) };
  const c = FakeTimers.withGlobal(globalThis).install({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  clock = c;
  start = c.now;
  const fake = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const realHandles = new WeakSet<object>();
  const realOne = <T extends object>(h: T) => { realHandles.add(h); return h; };

  Object.assign(globalThis, {
    setTimeout: (fn: any, ms?: number, ...a: unknown[]) => ((ms ?? 0) >= FROM ? fake.setTimeout(fn, ms, ...a) : realOne(real.setTimeout(fn, ms, ...a))),
    setInterval: (fn: any, ms?: number, ...a: unknown[]) => ((ms ?? 0) >= FROM ? fake.setInterval(fn, ms, ...a) : realOne(real.setInterval(fn, ms, ...a))),
    clearTimeout: (h: any) => (h && typeof h === "object" && realHandles.has(h) ? real.clearTimeout(h) : fake.clearTimeout(h)),
    clearInterval: (h: any) => (h && typeof h === "object" && realHandles.has(h) ? real.clearInterval(h) : fake.clearInterval(h)),
  });
  // `new Date()`, `Date.now()` and `Date()` read the advanced time; `new Date(x)` and instanceof are the real Date's.
  const now = () => real.Date.now() + advanced();
  globalThis.Date = new Proxy(real.Date, {
    construct: (D, args) => (args.length ? new D(...(args as [])) : new D(now())),
    apply: () => new real.Date(now()).toString(),
    get: (D, k) => (k === "now" ? now : Reflect.get(D, k)),
  });
  performance.now = () => real.now() + advanced();
  Bun.sleep = ((ms: number | Date) => {
    const wait = ms instanceof real.Date ? ms.getTime() - now() : ms;
    return new Promise<void>((r) => setTimeout(r, wait));
  }) as typeof Bun.sleep;
  AbortSignal.timeout = (ms: number) => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
    return ac.signal;
  };
}

/** How far this thread's clock was advanced, in ms: a new worker starts at the host's (`skip`). */
export const advanced = () => (clock ? clock.now - start : 0);

/** Puts `Date` `ms` further ahead without firing a timer: a worker catching up with the host it starts in. */
export function skip(ms: number) {
  start -= ms;
}

/** Moves this thread's clock `ms` forward, firing every timer that comes due on the way (each after the promises before it settle). */
export async function advance(ms: number): Promise<void> {
  if (!clock) throw new Error("clock/advance: the host runs on the real clock (PAL_TEST_CLOCK unset)");
  await clock.tickAsync(ms);
}
