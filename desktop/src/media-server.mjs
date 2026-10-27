/**
 * Local video server (127.0.0.1 only). What the browser can't do, ffmpeg
 * does here, on the user's Mac:
 *  - /probe     real tracks of a file (audio languages, codecs) via ffprobe
 *  - /stream    the file re-packaged for the player: video copied as-is
 *               (no re-encoding, ~no CPU), the chosen audio track converted
 *               to AAC (fixes AC3/DTS silence), as fragmented MP4. Starts at
 *               ?ss= seconds: seeking restarts ffmpeg there.
 *  - /seekpoint the keyframe at or before ?ss=: copying video can only
 *               start on one, so the player seeks there to keep its clock
 *               (and subtitles) exact
 *  - /subtitle  a subtitle track embedded in the file, as WebVTT
 * Requests carry the addon's headers if it needs any (proxyHeaders).
 * Every request needs ?t=<token> so other local pages can't use it.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";

const PROBE_TIMEOUT_MS = 30_000;

/** ffmpeg's -headers value: "Name: value\r\n" lines. */
export function headerArg(headers) {
  const entries = Object.entries(headers ?? {}).filter(([k, v]) => k && v != null);
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}\r\n`).join("") : null;
}

function decodeHeaders(h) {
  if (!h) return {};
  try {
    return JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/** This Mac's address on the local network (what the TV connects to). */
export function lanAddress() {
  const candidates = Object.entries(os.networkInterfaces())
    .flatMap(([name, addrs]) => (addrs ?? []).map((a) => ({ name, ...a })))
    .filter((a) => a.family === "IPv4" && !a.internal);
  // Prefer Wi-Fi/Ethernet (en0, en1…) over VPN/virtual interfaces.
  candidates.sort((a, b) => Number(!a.name.startsWith("en")) - Number(!b.name.startsWith("en")));
  return candidates[0]?.address ?? null;
}

/** Move WebVTT cues `delta` seconds (same as the UI's shiftVtt). */
export function shiftVtt(vtt, delta) {
  if (!delta) return vtt;
  const time = (t) => {
    const p = t.split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const fmt = (sec) => {
    const ms = Math.round(sec * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(ms % 1000, 3)}`;
  };
  const timing = /^((?:\d+:)?\d{1,2}:\d{2}\.\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{1,3})(.*)$/;
  const [header, ...blocks] = vtt.replace(/\r\n?/g, "\n").split(/\n\n+/);
  const out = [header];
  for (const block of blocks) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => timing.test(l));
    if (i < 0) {
      out.push(block);
      continue;
    }
    const [, a, b, rest] = lines[i].match(timing);
    const s = time(a) + delta;
    const e = time(b) + delta;
    if (e <= 0) continue;
    lines[i] = `${fmt(Math.max(0, s))} --> ${fmt(e)}${rest}`;
    out.push(lines.join("\n"));
  }
  return out.join("\n\n").trimEnd() + "\n";
}

/** Shape ffprobe's JSON into what the player needs. */
export function summarizeProbe(data) {
  const streams = data.streams ?? [];
  const pick = (type) => streams.filter((s) => s.codec_type === type);
  const video = pick("video").find((s) => !s.disposition?.attached_pic);
  return {
    duration: Number(data.format?.duration) || null,
    container: data.format?.format_name ?? null,
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, pixFmt: video.pix_fmt } : null,
    audio: pick("audio").map((s, order) => ({
      order,
      codec: s.codec_name,
      channels: s.channels,
      language: s.tags?.language ?? null,
      title: s.tags?.title ?? null,
      default: Boolean(s.disposition?.default),
    })),
    subtitles: pick("subtitle").map((s, order) => ({
      order,
      codec: s.codec_name,
      language: s.tags?.language ?? null,
      title: s.tags?.title ?? null,
      // Bitmap subtitles (PGS/VobSub) can't become WebVTT text.
      text: !["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"].includes(s.codec_name),
      forced: Boolean(s.disposition?.forced),
    })),
  };
}

/** ffmpeg arguments for /stream. */
export function streamArgs({ url, headers, audio = 0, start = 0, videoMode = "copy", videoCodec, format = "mp4" }) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  const h = headerArg(headers);
  if (h) args.push("-headers", h);
  // Reconnect on dropped connections (debrid/CDN hiccups).
  args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
  if (start > 0) {
    // Copied video can only start on a keyframe (K <= start). By default
    // ffmpeg still trims the converted audio to exactly `start`, so audio
    // ran ahead of the picture by start - K (up to the keyframe interval,
    // often several seconds). -noaccurate_seek starts both at K; the player
    // asks /seekpoint for K first, so its clock and subtitles match.
    // Re-encoded video can start anywhere: keep the exact seek there.
    if (videoMode !== "h264") args.push("-noaccurate_seek");
    args.push("-ss", String(start)); // before -i: fast seek
  }
  args.push("-i", url, "-map", "0:v:0", "-map", `0:a:${audio}?`, "-sn", "-dn");
  if (videoMode === "h264") {
    // Hardware encoder on Apple Silicon/Intel Macs: for codecs the player
    // can't decode at all.
    args.push("-c:v", "h264_videotoolbox", "-b:v", "8M", "-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "copy");
    if (videoCodec === "hevc") args.push("-tag:v", "hvc1"); // what Apple decoders expect
  }
  args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
  if (format === "mpegts") {
    // DLNA TVs handle an endless MPEG-TS stream better than fragmented MP4.
    if (videoMode !== "h264" && videoCodec === "hevc") args.splice(args.indexOf("-tag:v"), 2);
    args.push("-f", "mpegts", "pipe:1");
  } else {
    args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
  }
  return args;
}

export function startMediaServer({ ffmpegPath, ffprobePath, log = console }) {
  const token = randomBytes(18).toString("base64url");
  const probeCache = new Map();
  /** Cast sessions the TV may fetch: random id → stream params (+ subtitles). */
  const casts = new Map();

  function probe(url, headers) {
    const key = url;
    if (probeCache.has(key)) return probeCache.get(key);
    const promise = new Promise((resolve, reject) => {
      const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams"];
      const h = headerArg(headers);
      if (h) args.push("-headers", h);
      args.push(url);
      const p = spawn(ffprobePath, args);
      let out = "";
      let err = "";
      const timer = setTimeout(() => p.kill("SIGKILL"), PROBE_TIMEOUT_MS);
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(err.trim() || `ffprobe exited ${code}`));
        try {
          resolve(summarizeProbe(JSON.parse(out)));
        } catch (e) {
          reject(e);
        }
      });
    });
    probeCache.set(key, promise);
    promise.catch(() => probeCache.delete(key));
    return promise;
  }

  /** Last video keyframe at or before `ss` (seconds). */
  function seekpoint(url, headers, ss) {
    return new Promise((resolve) => {
      const from = Math.max(0, ss - 20);
      const args = ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey"];
      const h = headerArg(headers);
      if (h) args.push("-headers", h);
      args.push("-read_intervals", `${from}%${ss + 0.5}`, "-show_entries", "frame=best_effort_timestamp_time,pts_time", "-of", "json", url);
      const p = spawn(ffprobePath, args);
      let out = "";
      const timer = setTimeout(() => p.kill("SIGKILL"), PROBE_TIMEOUT_MS);
      p.stdout.on("data", (d) => (out += d));
      p.on("close", () => {
        clearTimeout(timer);
        try {
          const times = (JSON.parse(out).frames ?? [])
            .map((f) => Number(f.best_effort_timestamp_time ?? f.pts_time))
            .filter((t) => Number.isFinite(t) && t <= ss + 0.05);
          resolve(times.length ? Math.max(...times) : ss);
        } catch {
          resolve(ss);
        }
      });
    });
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body));
  }

  /** Pipe an ffmpeg process to the response; kill it when the player
   * leaves. Headers wait for the first bytes, so a failure (bad URL, dead
   * link) becomes a real error instead of an empty 200. */
  function pipeFfmpeg(req, res, args, contentType) {
    log.info?.("[media] ffmpeg", args.filter((a) => !a.includes("\r\n")).join(" ").replace(/https?:\/\/\S+/, "<url>"));
    const p = spawn(ffmpegPath, args);
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.stdout.once("data", (first) => {
      res.writeHead(200, { "Content-Type": contentType, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
      res.write(first);
      p.stdout.pipe(res);
    });
    req.on("close", () => p.kill("SIGKILL"));
    p.on("close", (code) => {
      if (!res.headersSent) {
        log.warn?.("[media] ffmpeg failed", code, stderr.slice(-500));
        sendJson(res, 502, { error: stderr.trim().split("\n").pop() || `ffmpeg exited ${code}` });
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      return res.end();
    }
    if (u.searchParams.get("t") !== token) return sendJson(res, 403, { error: "bad token" });
    const url = u.searchParams.get("u");
    if (!url || !/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: "missing url" });
    const headers = decodeHeaders(u.searchParams.get("h"));

    try {
      if (u.pathname === "/probe") {
        return sendJson(res, 200, await probe(url, headers));
      }
      if (u.pathname === "/seekpoint") {
        const ss = Math.max(0, Number(u.searchParams.get("ss") ?? 0) || 0);
        return sendJson(res, 200, { start: ss > 0 ? await seekpoint(url, headers, ss) : 0 });
      }
      if (u.pathname === "/stream") {
        const args = streamArgs({
          url,
          headers,
          audio: Number(u.searchParams.get("a") ?? 0) || 0,
          start: Number(u.searchParams.get("ss") ?? 0) || 0,
          videoMode: u.searchParams.get("vm") === "h264" ? "h264" : "copy",
          videoCodec: u.searchParams.get("vc") ?? undefined,
        });
        return pipeFfmpeg(req, res, args, "video/mp4");
      }
      if (u.pathname === "/subtitle") {
        const s = Number(u.searchParams.get("s") ?? 0) || 0;
        const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
        const h = headerArg(headers);
        if (h) args.push("-headers", h);
        args.push("-i", url, "-map", `0:s:${s}`, "-f", "webvtt", "pipe:1");
        return pipeFfmpeg(req, res, args, "text/vtt; charset=utf-8");
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 502, { error: String(err.message ?? err) });
    }
  });

  // --- LAN side, for casting: the TV can only reach the Mac's network
  // address. It serves ONLY registered cast sessions (unguessable ids), never
  // the general /probe or /stream endpoints. ---
  const lan = http.createServer((req, res) => {
    const m = new URL(req.url, "http://lan").pathname.match(/^\/cast\/([\w-]+)\/(media|subs\.vtt)$/);
    const cast = m && casts.get(m[1]);
    if (!cast) {
      res.writeHead(404);
      return res.end();
    }
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (m[2] === "subs.vtt") {
      res.writeHead(200, { ...cors, "Content-Type": "text/vtt; charset=utf-8" });
      return res.end(cast.vtt ?? "WEBVTT\n");
    }
    const contentType = cast.format === "mpegts" ? "video/mp2t" : "video/mp4";
    const dlna = {
      "transferMode.dlna.org": "Streaming",
      "contentFeatures.dlna.org": `DLNA.ORG_PN=${cast.format === "mpegts" ? "MPEG_TS_HD_NA_ISO" : "AVC_MP4_HP_HD_AAC"};DLNA.ORG_OP=00;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=01700000000000000000000000000000`,
    };
    if (req.method === "HEAD") {
      res.writeHead(200, { ...cors, ...dlna, "Content-Type": contentType });
      return res.end();
    }
    log.info?.("[cast] TV fetching", m[1], cast.format, "from", cast.start, "s");
    const args = streamArgs(cast);
    const p = spawn(ffmpegPath, args);
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.stdout.once("data", (first) => {
      res.writeHead(200, { ...cors, ...dlna, "Content-Type": contentType, "Cache-Control": "no-store" });
      res.write(first);
      p.stdout.pipe(res);
    });
    req.on("close", () => p.kill("SIGKILL"));
    p.on("close", (code) => {
      if (!res.headersSent) {
        log.warn?.("[cast] ffmpeg failed", code, stderr.slice(-400));
        res.writeHead(502);
        res.end();
      } else if (!res.writableEnded) res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      lan.listen(0, "0.0.0.0", () => {
        const lanPort = lan.address().port;
        resolve({
          base: `http://127.0.0.1:${port}`,
          token,
          /** Keyframe at or before `ss` (for exact clocks when casting). */
          seekpoint: (url, headers, ss) => (ss > 0 ? seekpoint(url, headers, ss) : Promise.resolve(0)),
          /** Make a stream reachable by a TV on the LAN. */
          registerCast({ url, headers, audio = 0, start = 0, videoMode = "copy", videoCodec, format = "mp4", vtt }) {
            const host = lanAddress();
            if (!host) throw new Error("No encontramos la red local del Mac (¿Wi-Fi apagado?)");
            const id = randomBytes(12).toString("base64url");
            casts.clear(); // one cast at a time
            casts.set(id, { url, headers, audio, start, videoMode, videoCodec, format, vtt: vtt ? shiftVtt(vtt, -start) : null });
            const base = `http://${host}:${lanPort}/cast/${id}`;
            return { url: `${base}/media`, subtitlesUrl: vtt ? `${base}/subs.vtt` : null, contentType: format === "mpegts" ? "video/mp2t" : "video/mp4" };
          },
          clearCasts: () => casts.clear(),
          close: () => {
            server.close();
            lan.close();
          },
        });
      });
    });
  });
}
