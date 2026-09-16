// Wi-Fi over the core's wifi capability: sections Current (the network
// the machine is on, with signal, channel and IP), Known (the saved
// networks) and Available (a scan), plus a row to turn the radio off or
// on. Enter joins (a form asks for the password of a secured network that
// is not saved); Forget asks first; Copy password reads the saved secret
// (the macOS keychain prompts, which is the user's own action). On macOS a
// scan takes seconds, so Available shows the last scan and a "Scan"
// row runs a fresh one; on Linux `nmcli` answers from its own cache.
// Live: listed again on every show.
import { wifi, xdg, type Accessory, type Action, type Ctx, type Effect, type Extension, type Form, type Item, type WifiNetwork } from "@zcag/pal";

const MAC = process.platform === "darwin";
const WIFI = xdg("network-wireless")!;
const LOCK = "\u{f033e}"; // md-lock

/** Signal as four bars: `▂▄▆█` filled to the strength. */
export const bars = (signal: number): string => "▂▄▆█".slice(0, Math.max(1, Math.ceil(signal / 25)));

const signalAccessory = (signal: number | null): Accessory[] => (signal === null ? [] : [{ text: `${bars(signal)} ${signal}%` }]);

const joinAction: Action = { id: "join", title: "Join" };
const copyPassword: Action = { id: "password", title: "Copy Password", shortcut: "cmd+shift+c" };
const forget = (ssid: string): Action => ({ id: "forget", title: "Forget", shortcut: "ctrl+x", style: "destructive", confirm: `Forget ${ssid}? Its password goes with it.` });

function available(n: WifiNetwork): Item {
  return {
    id: `net:${n.ssid}`,
    name: n.ssid,
    subtitle: [n.security ?? "Open", n.channel && `channel ${n.channel}`].filter(Boolean).join(" · "),
    icon: n.security ? LOCK : WIFI,
    keywords: ["wifi", "network"],
    accessories: signalAccessory(n.signal),
    actions: [joinAction, { id: "copy", title: "Copy Name", shortcut: "cmd+c" }],
    section: "Available",
  };
}

const failed = (what: string, e: unknown): Effect => ({ keep: true, toast: { title: `Could not ${what}`, message: String((e as Error)?.message ?? e), style: "failure" } });
const ssidOf = (id: string) => id.slice(id.indexOf(":") + 1);

function passwordForm(ssid: string, id: string, error?: string): Form {
  return {
    id,
    title: `Join ${ssid}`,
    fields: [{ id: "password", kind: "password", label: "Password", required: true, placeholder: "The network's password" }],
    submit: { id: "join_with", title: "Join" },
    errors: error ? { password: error } : undefined,
  };
}

export default {
  palettes: {
    wifi: {
      title: "Wi-Fi",
      icon: WIFI,
      live: true,
      placeholder: "Join a network",
      list: async () => {
        let status;
        try {
          status = await wifi.status();
        } catch (e) {
          return [{ id: "error", name: "Wi-Fi is not available", subtitle: String((e as Error)?.message ?? e), icon: xdg("dialog-error")!, actions: [] }];
        }
        if (!status.interface) return [{ id: "error", name: "No Wi-Fi interface", icon: xdg("dialog-error")!, actions: [] }];
        const items: Item[] = [];
        const cur = status.current;
        if (cur) {
          const details = [cur.ip, cur.channel && `channel ${cur.channel}`, cur.security].filter(Boolean).join(" · ");
          const actions: Action[] = [];
          if (cur.ip) actions.push({ id: "copy_ip", title: "Copy IP", shortcut: "cmd+c" });
          if (cur.ssid) actions.push(copyPassword, forget(cur.ssid));
          items.push({
            id: `current:${cur.ssid ?? ""}`,
            name: cur.ssid ?? "Connected network",
            subtitle: cur.ssid ? details : `${details} · name hidden by macOS without Location Services`,
            icon: WIFI,
            keywords: ["wifi", "network", "current"],
            accessories: [...signalAccessory(cur.signal), { tag: "connected", color: "green" }],
            actions,
            section: "Current",
          });
        }
        const known = status.powered ? await wifi.known().catch(() => []) : [];
        const scan = status.powered ? await wifi.scan(MAC ? "cached" : "auto").catch(() => ({ networks: [], hidden: 0, age_secs: null })) : { networks: [], hidden: 0, age_secs: null };
        const seen = new Map(scan.networks.map((n) => [n.ssid, n]));
        for (const k of known) {
          if (k.ssid === cur?.ssid) continue;
          const n = seen.get(k.ssid);
          items.push({
            id: `known:${k.ssid}`,
            name: k.ssid,
            subtitle: n ? [n.security ?? "Open", n.channel && `channel ${n.channel}`].filter(Boolean).join(" · ") : "Saved",
            icon: WIFI,
            keywords: ["wifi", "network", "saved"],
            accessories: n ? [...signalAccessory(n.signal), { tag: "in range", color: "blue" }] : [],
            actions: [joinAction, copyPassword, forget(k.ssid)],
            section: "Known",
          });
        }
        const knownNames = new Set(known.map((k) => k.ssid));
        for (const n of scan.networks) if (!n.current && !knownNames.has(n.ssid) && n.ssid !== cur?.ssid) items.push(available(n));
        if (status.powered && (MAC || scan.hidden > 0)) {
          const age = scan.age_secs === null ? (scan.networks.length || scan.hidden ? "just scanned" : "no scan yet") : `scanned ${scan.age_secs} s ago`;
          const hidden = scan.hidden > 0 ? `${scan.hidden} nearby with names hidden by macOS` : "";
          items.push({
            id: "scan",
            name: "Scan for Networks",
            subtitle: [age, hidden, MAC ? "takes a few seconds" : ""].filter(Boolean).join(" · "),
            icon: xdg("system-search")!,
            keywords: ["rescan", "refresh"],
            actions: [{ id: "scan", title: "Scan" }],
            section: "Available",
          });
        }
        items.push({
          id: "power",
          name: status.powered ? "Turn Wi-Fi Off" : "Turn Wi-Fi On",
          subtitle: status.interface,
          icon: xdg(status.powered ? "changes-prevent" : "changes-allow")!,
          keywords: ["wifi", "radio", "toggle", "power"],
          actions: [{ id: "power", title: status.powered ? "Turn Off" : "Turn On" }],
          section: "Wi-Fi",
        });
        return items;
      },
      pick: async (id, action, ctx?: Ctx) => {
        if (id === "error") return { keep: true };
        if (id === "power") {
          const { powered } = await wifi.status();
          try { await wifi.setPower(!powered); } catch (e) { return failed(`turn Wi-Fi ${powered ? "off" : "on"}`, e); }
          return { keep: true };
        }
        if (id === "scan") {
          try { await wifi.scan("fresh"); } catch (e) { return failed("scan", e); }
          return { keep: true };
        }
        const ssid = ssidOf(id);
        switch (action) {
          case "copy":
            return { copy: ssid };
          case "copy_ip": {
            const ip = (await wifi.status()).current?.ip;
            return ip ? { copy: ip } : failed("copy the IP", "no address");
          }
          case "password": {
            try { return { copy: await wifi.password(ssid) }; } catch (e) { return failed("read the password", e); }
          }
          case "forget": {
            try { await wifi.forget(ssid); } catch (e) { return failed(`forget ${ssid}`, e); }
            return { keep: true, toast: { title: `Forgot ${ssid}`, style: "success" } };
          }
          case "join_with": {
            const password = String(ctx?.values?.password ?? "");
            try { await wifi.join(ssid, password); } catch (e) { return { form: passwordForm(ssid, id, String((e as Error)?.message ?? e)) }; }
            return { hud: `Joined ${ssid}` };
          }
          default: {
            // A saved or open network joins at once; a secured new one is asked for its password.
            if (id.startsWith("net:")) {
              const n = (await wifi.scan("cached").catch(() => ({ networks: [] as WifiNetwork[] }))).networks.find((n) => n.ssid === ssid);
              if (n?.security && !n.known) return { form: passwordForm(ssid, id) };
            }
            try { await wifi.join(ssid); } catch (e) { return id.startsWith("net:") ? { form: passwordForm(ssid, id, String((e as Error)?.message ?? e)) } : failed(`join ${ssid}`, e); }
            return { hud: `Joined ${ssid}` };
          }
        }
      },
    },
  },
} satisfies Extension;
