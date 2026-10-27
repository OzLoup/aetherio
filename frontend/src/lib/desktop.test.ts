import { describe, expect, it } from "vitest";
import { audioTrackLabel, canPlayDirect, pickAudioTrack, verifiedLanguages, type ProbeAudio, type ProbeInfo } from "./desktop";

const t = (order: number, language: string | null, title: string | null, codec = "aac", def = false): ProbeAudio => ({
  order,
  language,
  title,
  codec,
  channels: 2,
  default: def,
});

describe("pickAudioTrack", () => {
  const tracks = [t(0, "eng", null, "aac", true), t(1, "spa", "Castellano", "ac3"), t(2, "spa", "Latino", "ac3")];
  it("prefers Latino for es-419 and Castellano for es-ES", () => {
    expect(pickAudioTrack(tracks, "es-419")).toBe(2);
    expect(pickAudioTrack(tracks, "es-ES")).toBe(1);
  });
  it("takes any Spanish track when there's no hint", () => {
    expect(pickAudioTrack([t(0, "jpn", null, "aac", true), t(1, "spa", null)], "es-419")).toBe(1);
  });
  it("falls back to the default track", () => {
    expect(pickAudioTrack([t(0, "jpn", null), t(1, "eng", null, "aac", true)], "es-419")).toBe(1);
    expect(pickAudioTrack([], "es-419")).toBe(0);
  });
  it("picks English for an English profile", () => {
    expect(pickAudioTrack(tracks, "en")).toBe(0);
  });
});

describe("canPlayDirect", () => {
  const base: ProbeInfo = { duration: 100, container: "mov,mp4,m4a", video: { codec: "h264", width: 1, height: 1 }, audio: [t(0, "eng", null)], subtitles: [] };
  it("plays simple MP4/AAC directly", () => expect(canPlayDirect(base, 0)).toBe(true));
  it("routes MKV, AC3 and multi-track files through the local server", () => {
    expect(canPlayDirect({ ...base, container: "matroska,webm" }, 0)).toBe(false);
    expect(canPlayDirect({ ...base, audio: [t(0, "spa", null, "ac3")] }, 0)).toBe(false);
    expect(canPlayDirect({ ...base, audio: [t(0, "eng", null), t(1, "spa", null)] }, 1)).toBe(false);
  });
});

describe("audioTrackLabel", () => {
  it("reads nicely", () => {
    expect(audioTrackLabel({ ...t(0, "spa", "Latino", "ac3"), channels: 6 })).toBe("Español — Latino (AC3 5.1)");
  });
});

describe("verifiedLanguages", () => {
  it("turns real tracks into language tags", () => {
    const info: ProbeInfo = {
      duration: 1, container: "matroska,webm", video: null, subtitles: [],
      audio: [t(0, "spa", "Español Latino"), t(1, "spa", "Castellano"), t(2, "eng", null), t(3, "spa", null), t(4, "und", null)],
    };
    expect(verifiedLanguages(info)).toEqual(["latino", "castellano", "english", "espanol"]);
  });
});
