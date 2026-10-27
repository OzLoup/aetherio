import { describe, expect, it } from "vitest";
import type { AddonRef } from "@/lib/stremio";
import { isMultiAudio, languageOptions, languageScore, lighterOption, overMaxQuality, parseStream, qualityOptions, sizeMb, sortStreams, toAlt } from "./streams";
import { shiftVtt, srtToVtt } from "./subtitles";

const torrentio: AddonRef = {
  transportUrl: "https://torrentio.strem.fun/x/manifest.json",
  manifest: { id: "t", name: "Torrentio", version: "1", resources: ["stream"], types: ["movie"] },
};

function parse(name: string, title: string, url = "https://torrentio.strem.fun/realdebrid/k/h/null/0/f.mkv", i = 0) {
  return parseStream({ name, title, url }, torrentio, 0, i)!;
}

describe("parseStream", () => {
  it("reads quality, RD cache, size and Latino audio from a Torrentio result", () => {
    const s = parse(
      "[RD+] Torrentio\n1080p",
      "Pelicula.2023.1080p.WEB-DL.Dual.Latino.x264.mkv\n👤 120 💾 2.4 GB ⚙️ Cinecalidad\nMulti Audio\n🇲🇽 / 🇬🇧",
    );
    expect(s.quality).toBe("1080p");
    expect(s.cached).toBe(true);
    expect(s.size).toBe("2.4 GB");
    expect(s.languages).toContain("latino");
    expect(s.languages).toContain("multi");
    expect(s.languages).not.toContain("castellano");
    expect(s.webRisk).toBe(true); // .mkv
  });

  it("keeps castellano when Spain is explicit", () => {
    const s = parse("[RD download] Torrentio\n4k", "Movie.2160p.HEVC.HDR.Castellano.Latino.mkv\n🇪🇸 / 🇲🇽");
    expect(s.cached).toBe(false);
    expect(s.quality).toBe("4K");
    expect(s.languages).toEqual(expect.arrayContaining(["latino", "castellano"]));
    expect(s.languages).not.toContain("espanol");
    expect(s.hevc && s.hdr).toBe(true);
  });

  it("marks torrent-only streams as not directly playable", () => {
    const s = parseStream({ name: "Torrentio\n720p", infoHash: "abc", fileIdx: 0 }, torrentio, 0, 0)!;
    expect(s.kind).toBe("torrent");
  });

  it("detects Comet cache marks", () => {
    expect(parse("[RD⚡] Comet 1080p", "x").cached).toBe(true);
    expect(parse("[RD⬇️] Comet 1080p", "x").cached).toBe(false);
  });
});

describe("sortStreams", () => {
  it("puts Latino cached first for a Latino profile", () => {
    const english = parse("[RD+] Torrentio\n1080p", "Movie.1080p.mp4", undefined, 0);
    const latinoUncached = parse("[RD download] Torrentio\n1080p", "Movie.Latino.mp4", undefined, 1);
    const latinoCached = parse("[RD+] Torrentio\n720p", "Movie.720p.Latino.mp4", undefined, 2);
    const order = sortStreams([english, latinoUncached, latinoCached], "es-419").map((s) => s.key);
    expect(order).toEqual([latinoCached.key, latinoUncached.key, english.key]);
    expect(languageScore(english, "es-419")).toBe(0);
  });
});

describe("srtToVtt", () => {
  it("converts timings and drops cue numbers", () => {
    const vtt = srtToVtt("﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<font color=red>Hola</font>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\nAcción\r\n");
    expect(vtt).toBe("WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHola\n\n00:00:04.000 --> 00:00:05.250\nAcción\n");
  });

  it("rejects non-SRT formats like MicroDVD", () => {
    expect(() => srtToVtt("{100}{200}Hola|mundo")).toThrow();
  });
});

describe("languageOptions", () => {
  it("offers the best ready stream per audio language", () => {
    const latinoUncached = parse("[RD download] Torrentio\n1080p", "Movie.Latino.mkv", undefined, 0);
    const latino = parse("[RD+] Torrentio\n720p", "Movie.Latino.mp4", undefined, 1);
    const original = parse("[RD+] Torrentio\n1080p", "Movie.1080p.mp4", undefined, 2);
    const cast = parse("[RD+] Torrentio\n1080p", "Movie.Castellano.mp4", undefined, 3);
    const opts = languageOptions([latinoUncached, latino, original, cast].map(toAlt));
    expect(opts.map((o) => o.langs)).toEqual([["latino"], ["original"], ["castellano"]]);
    expect(opts[0].alt.stream).toBe(latino.stream);
  });
});

describe("audio codec risk", () => {
  it("flags AC3/DTS without AAC and ranks it lower", () => {
    const ac3 = parse("[RD+] Torrentio\n1080p", "Pelicula.1080p.Latino.AC3.5.1.mp4", undefined, 0);
    const ddp = parse("[RD+] Torrentio\n1080p", "Pelicula.1080p.Latino.DDP5.1.mp4", undefined, 1);
    const aac = parse("[RD+] Torrentio\n1080p", "Pelicula.1080p.Latino.AAC.2.0.mp4", undefined, 2);
    const both = parse("[RD+] Torrentio\n1080p", "Pelicula.Dual.Latino.AC3.Ingles.AAC.mp4", undefined, 3);
    expect([ac3.audioRisk, ddp.audioRisk, aac.audioRisk, both.audioRisk]).toEqual([true, true, false, false]);
    expect(sortStreams([ac3, aac], "es-419")[0].key).toBe(aac.key);
    expect(languageOptions([ac3, aac].map(toAlt))[0].alt.stream).toBe(aac.stream);
  });
});

describe("multi-audio files", () => {
  const multi = parse("[RD+] Torrentio\n1080p", "Black.Clover.S01E01.1080p.mkv\nMulti Audio\n🇯🇵 / 🇬🇧 / 🇲🇽 / 🇪🇸 / 🇧🇷", "https://x/multi.mkv", 0);
  const latino = parse("[RD+] Torrentio\n720p", "Black.Clover.S01E01.720p.Latino.mp4", "https://x/latino.mp4", 1);
  const original = parse("[RD+] Torrentio\n1080p", "Black.Clover.S01E01.1080p.mp4", "https://x/original.mp4", 2);

  it("detects them, including Japanese", () => {
    expect(isMultiAudio(multi.languages)).toBe(true);
    expect(multi.languages).toContain("japones");
    expect(isMultiAudio(latino.languages)).toBe(false);
  });

  it("ranks a single-language Latino file above a multi-audio one", () => {
    expect(sortStreams([multi, latino], "es-419")[0].key).toBe(latino.key);
  });

  it("shows one entry per distinct file, preferring single-language files", () => {
    const opts = languageOptions([multi, latino, original].map(toAlt));
    const urls = opts.map((o) => o.alt.stream.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(opts.find((o) => o.langs.includes("latino"))!.alt.stream).toBe(latino.stream);
    const multiEntry = opts.find((o) => o.multi)!;
    expect(multiEntry.langs).toEqual(expect.arrayContaining(["japones", "english", "portugues"]));
    expect(multiEntry.langs).not.toContain("latino");
  });
});

describe("subtitle releases", () => {
  it("doesn't take subtitle flags for audio (Erai-raws, Real-Debrid shows Japanese only)", () => {
    const s = parse("[RD+] Torrentio\n1080p", "[Erai-raws] Black Clover (TV) - 001 [1080p][Multiple Subtitle][284B3626].mkv\n🇬🇧 / 🇲🇽 / 🇪🇸 / 🇧🇷");
    expect(s.languages).toEqual([]);
    expect(s.subtitleLanguages).toEqual(expect.arrayContaining(["latino", "english", "portugues"]));
    expect(isMultiAudio(s.languages)).toBe(false);
    expect(languageScore(s, "es-419")).toBe(0);
  });

  it("treats 'Subtitulado.Esp' as original audio with Spanish subtitles", () => {
    const s = parse("[RD+] Torrentio\n1080p", "Carrie.S01E01.1080p.HDTV.Subtitulado.Esp.SC\n🇪🇸");
    expect(s.languages).toEqual([]);
    expect(s.subtitleLanguages).toContain("espanol");
  });

  it("keeps the audio when the name also marks it", () => {
    const s = parse("[RD+] Torrentio\n1080p", "Pelicula.2024.1080p.Dual.Latino.Ingles.Subs.mkv\n🇲🇽 / 🇬🇧");
    expect(s.languages).toEqual(expect.arrayContaining(["latino", "english"]));
  });
});

describe("shiftVtt", () => {
  const vtt = "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nUno\n\n00:01:10.500 --> 00:01:12.000 align:start\nDos\n";
  it("moves cues earlier and drops the ones already past", () => {
    expect(shiftVtt(vtt, -60)).toBe("WEBVTT\n\n00:00:10.500 --> 00:00:12.000 align:start\nDos\n");
  });
  it("is a no-op at 0", () => expect(shiftVtt(vtt, 0)).toBe(vtt));
});

describe("generic Spanish and addon priority", () => {
  it("reads 'English Spanish' (Torrentio adds 🇪🇸) as generic Spanish, close to Latino", () => {
    const s = parse("[RD+] Torrentio\n1080p", "Castlevania (2017) Season 1 (1080p BluRay x265 HEVC 10bit AAC 5.1 English Spanish t3nzin)\n🇬🇧 / 🇪🇸");
    expect(s.languages).toEqual(expect.arrayContaining(["english", "espanol"]));
    expect(s.languages).not.toContain("castellano");
    expect(languageScore(s, "es-419")).toBe(2);
  });

  it("lets the higher addon win among ready streams in the same language", () => {
    const torrentio = parse("[RD+] Torrentio\n1080p", "Pelicula.1080p.Latino.mp4", "https://t/1.mp4", 0);
    const primerAddon: AddonRef = {
      transportUrl: "https://p/manifest.json",
      manifest: { id: "p", name: "Primer Latino", version: "1", resources: ["stream"], types: ["movie"] },
    };
    // A direct link from an addon without debrid: no cache marks at all.
    const primer = { ...parseStream({ name: "Primer Latino 1080p", title: "Pelicula Latino", url: "https://p/1.mp4" }, primerAddon, 0, 0)!, key: "p" };
    const torrentioSecond = { ...torrentio, addonIndex: 1, key: "t" };
    expect(primer.cached).toBe(null);
    expect(sortStreams([torrentioSecond, primer], "es-419")[0].key).toBe("p");
  });

  it("still prefers a ready stream over one the debrid has to download", () => {
    const uncached = { ...parse("[RD download] Torrentio\n1080p", "Pelicula.Latino.mp4", "https://t/u.mp4"), key: "u", addonIndex: 0 };
    const ready = { ...parse("[RD+] Torrentio\n720p", "Pelicula.Latino.mp4", "https://t/r.mp4"), key: "r", addonIndex: 1 };
    expect(sortStreams([uncached, ready], "es-419")[0].key).toBe("r");
  });
});

describe("quality options", () => {
  const mk = (name: string, title: string, url: string) => toAlt(parse(name, title, url));
  const alts = [
    mk("[RD+] Torrentio\n1080p", "Peli.1080p.Latino.mp4 💾 2.4 GB", "https://x/1080a"),
    mk("[RD+] Torrentio\n1080p", "Peli.1080p.Latino.mp4 💾 3.1 GB", "https://x/1080b"),
    mk("[RD+] Torrentio\n720p", "Peli.720p.Latino.mp4 💾 1.1 GB", "https://x/720"),
    mk("[RD download] Torrentio\n480p", "Peli.480p.Latino.mp4 💾 600 MB", "https://x/480-uncached"),
    mk("[RD+] Torrentio\n480p", "Peli.480p.English.mp4 💾 500 MB", "https://x/480-eng"),
    mk("[RD+] Torrentio\n4k", "Peli.2160p.Latino.mkv 💾 14 GB", "https://x/4k"),
  ];
  it("lists one ready version per quality in the same language, current included", () => {
    const opts = qualityOptions(alts, "https://x/1080b", ["latino"], "es-419");
    expect(opts.map((o) => [o.quality, o.alt.stream.url, o.current])).toEqual([
      ["4K", "https://x/4k", false],
      ["1080p", "https://x/1080b", true],
      ["720p", "https://x/720", false],
    ]);
  });
  it("offers the next lighter quality", () => {
    expect(lighterOption(qualityOptions(alts, "https://x/4k", ["latino"], "es-419"))?.quality).toBe("1080p");
    expect(lighterOption(qualityOptions(alts, "https://x/720", ["latino"], "es-419"))).toBeNull();
  });
  it("matches originals with originals even when names don't say the language", () => {
    const anime = [
      mk("[RD+] Torrentio\n1080p", "[Erai-raws] Show - 01 [1080p][Multiple Subtitle].mkv 💾 1.4 GB", "https://x/a1080"),
      mk("[RD+] Torrentio\n720p", "[SubsPlease] Show - 01 (720p).mkv 💾 700 MB", "https://x/a720"),
      mk("[RD+] Torrentio\n1080p", "Show.S01E01.1080p.Latino.mkv 💾 1.2 GB", "https://x/lat"),
    ];
    // The app verified the playing file as Japanese.
    const opts = qualityOptions(anime, "https://x/a1080", ["japones"], "es-419");
    expect(opts.map((o) => o.alt.stream.url)).toEqual(["https://x/a1080", "https://x/a720"]);
  });
  it("parses sizes", () => {
    expect(sizeMb("2.4 GB")).toBeCloseTo(2457.6);
    expect(sizeMb("600 MB")).toBe(600);
    expect(sizeMb(null)).toBeNull();
  });
});

describe("max quality preference", () => {
  it("puts streams above the limit after the ones within it", () => {
    const big = { ...parse("[RD+] Torrentio\n4k", "Peli.2160p.Latino.mp4", "https://x/4k"), key: "4k" };
    const ok = { ...parse("[RD+] Torrentio\n1080p", "Peli.1080p.Latino.mp4", "https://x/1080"), key: "1080", addonIndex: 1 };
    expect(sortStreams([big, ok], "es-419", { maxQuality: "1080p" })[0].key).toBe("1080");
    expect(sortStreams([big, ok], "es-419", { maxQuality: "max" })[0].key).toBe("4k");
    expect(overMaxQuality({ quality: null }, "480p")).toBe(false);
  });
});
