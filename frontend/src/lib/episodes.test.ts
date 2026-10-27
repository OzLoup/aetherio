import { describe, expect, it } from "vitest";
import { resumePoint, type ProgressEntry } from "@/api/progress";
import { nextEpisode } from "./episodes";
import { progressContextFrom, streamsPath } from "./routes";

const ep = (season: number, episode: number, released = "2020-01-01") => ({ id: `tt1:${season}:${episode}`, season, episode, released });

describe("nextEpisode", () => {
  const videos = [ep(1, 2), ep(1, 1), ep(0, 1), ep(2, 1), ep(2, 2, "2999-01-01")];
  it("goes to the next one, across seasons, skipping specials", () => {
    expect(nextEpisode(videos, 1, 1)?.id).toBe("tt1:1:2");
    expect(nextEpisode(videos, 1, 2)?.id).toBe("tt1:2:1");
  });
  it("doesn't offer unreleased episodes", () => expect(nextEpisode(videos, 2, 1)).toBeNull());
});

describe("resumePoint", () => {
  const base = { position: 600, duration: 3000, watched: false } as ProgressEntry;
  it("resumes a started video", () => expect(resumePoint(base)).toBe(600));
  it("starts over when finished, barely started or in the credits", () => {
    expect(resumePoint({ ...base, watched: true })).toBe(0);
    expect(resumePoint({ ...base, position: 10 })).toBe(0);
    expect(resumePoint({ ...base, position: 2950 })).toBe(0);
  });
});

describe("progress context in the URL", () => {
  it("round-trips through streamsPath", () => {
    const ctx = { metaId: "tt1", type: "series", name: "Show", poster: "https://p/x.jpg", season: 1, episode: 2, episodeTitle: "Dos" };
    const url = new URL(streamsPath("series", "tt1:1:2", "Show · T1E2", ctx), "http://x");
    expect(progressContextFrom(url.searchParams, "series", "tt1:1:2")).toEqual(ctx);
  });
  it("derives the title id from an episode id for old links", () => {
    expect(progressContextFrom(new URLSearchParams("title=X"), "series", "kitsu:123:1:5").metaId).toBe("kitsu:123");
    expect(progressContextFrom(new URLSearchParams("title=X"), "movie", "tt9").metaId).toBe("tt9");
  });
});
