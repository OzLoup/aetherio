/**
 * Casting from the macOS app (Electron has no Google Cast). Talks to the
 * devices directly over the local network:
 *  - Chromecast / Google TV / TVs with Chromecast built-in (mDNS + castv2)
 *  - DLNA renderers: most Samsung/LG/Sony/AOC smart TVs, some Roku (SSDP + UPnP)
 * Same libraries WebTorrent Desktop uses.
 *
 * The TV either fetches the original link itself, or (MKV, AC3/DTS, a
 * chosen audio track…) our local server re-packages it on the Mac and the
 * TV reads it over the LAN — see media-server.mjs registerCast().
 */
import { spawn } from "node:child_process";
import chromecasts from "chromecasts";
import dlnacasts from "dlnacasts";

const STATUS_EVERY_MS = 1000;

export function startCasting({ onDevices, onStatus, log = console }) {
  const sources = [
    { kind: "chromecast", list: chromecasts() },
    { kind: "dlna", list: dlnacasts() },
  ];
  /** id → { kind, player } */
  const devices = new Map();
  let active = null; // { id, player, kind, timer }

  const describe = ([id, d]) => ({ id, name: friendly.get(d.player.host) ?? d.player.name, kind: d.kind, host: d.player.host });
  const publish = () => onDevices([...devices.entries()].map(describe));

  for (const { kind, list } of sources) {
    list.on("update", (player) => {
      // By host: the friendly name ("TV de Sala") can arrive a moment
      // after the technical one and must update, not duplicate, the entry.
      const id = `${kind}:${player.host}`;
      if (!player.host) return;
      if (!devices.has(id)) log.info?.("[cast] found", kind, player.name, player.host);
      devices.set(id, { kind, player });
      publish();
    });
    list.on("error", (err) => log.warn?.("[cast] discovery error", kind, err?.message ?? err));
  }

  // macOS: also browse through the system's Bonjour (mDNSResponder). It
  // works even before the Local Network permission is granted, helps macOS
  // ask for it, and gives us each Chromecast's friendly name ("TV de Sala"),
  // which the raw-multicast discovery often misses.
  /** host → friendly name */
  const friendly = new Map();
  if (process.platform === "darwin") browseBonjour();

  function browseBonjour() {
    try {
      const browse = spawn("/usr/bin/dns-sd", ["-B", "_googlecast._tcp", "local."]);
      browse.stdout.on("data", (d) => {
        for (const line of String(d).split("\n")) {
          if (!/\sAdd\s/.test(line)) continue;
          const instance = line.trim().split(/\s+/).slice(6).join(" ");
          const resolve = spawn("/usr/bin/dns-sd", ["-L", instance, "_googlecast._tcp", "local."]);
          const stopResolve = setTimeout(() => resolve.kill(), 5000);
          resolve.stdout.on("data", (r) => {
            const text = String(r);
            const host = text.match(/can be reached at (\S+?)\.?:\d+/)?.[1];
            const fn = text.match(/fn=((?:\\ |[^ \n])+)/)?.[1]?.replace(/\\ /g, " ");
            if (!host || !fn) return;
            clearTimeout(stopResolve);
            resolve.kill();
            friendly.set(host, fn);
            publish();
          });
        }
      });
      setTimeout(() => browse.kill(), 20_000);
    } catch (err) {
      log.warn?.("[cast] bonjour browse failed", err?.message ?? err);
    }
  }

  const call = (player, method, ...args) =>
    new Promise((resolve, reject) => {
      if (typeof player[method] !== "function") return resolve(null);
      player[method](...args, (err, res) => (err ? reject(err) : resolve(res)));
    });

  function stopPolling() {
    if (active?.timer) clearInterval(active.timer);
  }

  function poll() {
    stopPolling();
    const current = active;
    current.timer = setInterval(async () => {
      try {
        const s = await call(current.player, "status");
        if (!s) return;
        onStatus({
          id: current.id,
          device: friendly.get(current.player.host) ?? current.player.name,
          // Chromecast: playerState PLAYING/PAUSED/BUFFERING/IDLE; DLNA: similar strings
          state: String(s.playerState ?? s.state ?? "").toUpperCase(),
          currentTime: Number(s.currentTime ?? 0),
          duration: Number(s.media?.duration ?? s.duration ?? 0) || null,
          idleReason: s.idleReason ?? null,
        });
      } catch (err) {
        log.warn?.("[cast] status failed", err?.message ?? err);
      }
    }, STATUS_EVERY_MS);
  }

  return {
    list: () => [...devices.entries()].map(describe),
    refresh: () => {
      sources.forEach((s) => s.list.update?.());
      if (process.platform === "darwin") browseBonjour();
    },

    /** media: { url, title, type (MIME), startTime, subtitlesUrl? } */
    async play(id, media) {
      const device = devices.get(id);
      if (!device) throw new Error("Ese dispositivo ya no está disponible");
      if (active && active.id !== id) await this.stop().catch(() => {});
      const opts = { title: media.title, type: media.type };
      if (media.startTime > 0) opts.seek = media.startTime;
      if (media.subtitlesUrl && device.kind === "chromecast") {
        opts.subtitles = [media.subtitlesUrl];
        opts.autoSubtitles = true;
      }
      log.info?.("[cast] play", device.kind, device.player.name, media.type, media.startTime ?? 0);
      await call(device.player, "play", media.url, opts);
      active = { id, kind: device.kind, player: device.player, timer: null };
      poll();
      return { device: friendly.get(device.player.host) ?? device.player.name, kind: device.kind };
    },
    pause: () => (active ? call(active.player, "pause") : null),
    resume: () => (active ? call(active.player, "resume") : null),
    seek: (t) => (active ? call(active.player, "seek", t) : null),
    async stop() {
      if (!active) return;
      const { player } = active;
      stopPolling();
      active = null;
      await call(player, "stop").catch(() => {});
    },
    destroy() {
      stopPolling();
      sources.forEach((s) => s.list.destroy?.());
    },
  };
}
