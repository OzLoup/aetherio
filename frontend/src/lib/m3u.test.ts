import { describe, expect, it } from "vitest";
import { parseM3u } from "./m3u";

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="a.mx" tvg-logo="https://i/logo.png" group-title="News;Public",Canal A (1080p)
https://a.example/index.m3u8
#EXTINF:-1 tvg-id="b" http-referrer="https://ref/" group-title="Undefined",Canal B
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (X)
http://b.example/live.ts
#EXTINF:-1,Sin grupo
https://c.example/c.m3u8
`;

describe("parseM3u", () => {
  it("reads names, logos, groups, urls and headers", () => {
    const [a, b, c] = parseM3u(SAMPLE);
    expect(a).toMatchObject({ name: "Canal A (1080p)", logo: "https://i/logo.png", groups: ["News", "Public"], url: "https://a.example/index.m3u8" });
    expect(a.headers).toBeUndefined();
    expect(b).toMatchObject({ name: "Canal B", groups: ["General"], url: "http://b.example/live.ts" });
    expect(b.headers).toEqual({ Referer: "https://ref/", "User-Agent": "Mozilla/5.0 (X)" });
    expect(c).toMatchObject({ name: "Sin grupo", groups: ["General"] });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });
});
