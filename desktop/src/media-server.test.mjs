import assert from "node:assert/strict";
import { test } from "node:test";
import { headerArg, shiftVtt, startMediaServer, streamArgs, summarizeProbe } from "./media-server.mjs";

test("streamArgs copies video, converts the chosen audio to AAC and seeks before -i", () => {
  const args = streamArgs({ url: "https://x/a.mkv", audio: 1, start: 120, videoCodec: "hevc" });
  const i = args.indexOf("-i");
  assert.ok(args.indexOf("-ss") < i);
  // audio and copied video must start at the same keyframe (A/V sync)
  assert.ok(args.includes("-noaccurate_seek") && args.indexOf("-noaccurate_seek") < args.indexOf("-ss"));
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4), ["-map", "0:v:0", "-map", "0:a:1?"]);
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.equal(args[args.indexOf("-tag:v") + 1], "hvc1");
  assert.equal(args[args.indexOf("-c:a") + 1], "aac");
  assert.equal(args.at(-1), "pipe:1");
});

test("streamArgs re-encodes video only when asked", () => {
  const args = streamArgs({ url: "https://x/a.avi", videoMode: "h264" });
  assert.equal(args[args.indexOf("-c:v") + 1], "h264_videotoolbox");
  assert.ok(!args.includes("-ss"));
  const seeking = streamArgs({ url: "https://x/a.avi", videoMode: "h264", start: 30 });
  assert.ok(seeking.includes("-ss") && !seeking.includes("-noaccurate_seek"));
});

test("headerArg builds ffmpeg header lines", () => {
  assert.equal(headerArg({ Referer: "https://a/", "User-Agent": "X" }), "Referer: https://a/\r\nUser-Agent: X\r\n");
  assert.equal(headerArg({}), null);
});

test("summarizeProbe lists audio/subtitle tracks with languages", () => {
  const s = summarizeProbe({
    format: { duration: "1437.5", format_name: "matroska,webm" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
      { codec_type: "audio", codec_name: "ac3", channels: 6, tags: { language: "spa", title: "Latino" }, disposition: { default: 0 } },
      { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" }, disposition: { default: 1 } },
      { codec_type: "subtitle", codec_name: "ass", tags: { language: "spa" } },
      { codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle", tags: { language: "eng" } },
    ],
  });
  assert.equal(s.duration, 1437.5);
  assert.deepEqual(s.audio.map((a) => [a.order, a.language, a.title, a.default]), [[0, "spa", "Latino", false], [1, "eng", null, true]]);
  assert.deepEqual(s.subtitles.map((x) => x.text), [true, false]);
});

test("streamArgs can produce MPEG-TS for DLNA TVs", () => {
  const args = streamArgs({ url: "https://x/a.mkv", format: "mpegts", videoCodec: "hevc" });
  assert.equal(args[args.indexOf("-f") + 1], "mpegts");
  assert.ok(!args.includes("-tag:v"));
});

test("shiftVtt moves cues earlier", () => {
  const v = "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nUno\n\n00:01:10.500 --> 00:01:12.000\nDos\n";
  assert.equal(shiftVtt(v, -60), "WEBVTT\n\n00:00:10.500 --> 00:00:12.000\nDos\n");
});

test("the LAN side only serves registered cast sessions", async () => {
  const srv = await startMediaServer({ ffmpegPath: "/nonexistent", ffprobePath: "/nonexistent", log: {} });
  const cast = srv.registerCast({ url: "https://x/a.mkv", vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHola\n" });
  const lanBase = cast.url.replace(/\/cast\/.*/, "");
  assert.equal((await fetch(`${lanBase}/probe?u=x`)).status, 404);
  assert.equal((await fetch(`${lanBase}/cast/not-a-session/media`)).status, 404);
  const subs = await fetch(cast.subtitlesUrl);
  assert.equal(subs.status, 200);
  assert.match(await subs.text(), /Hola/);
  srv.close();
});
