import { describe, expect, it } from "vitest";
import { countryFlag, parseM3u } from "./m3u";
import { hideAdult, setAdultAllowed } from "./stremio";

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
    expect([a.country, b.country, c.country]).toEqual(["MX", undefined, undefined]);
  });

  it("reads the country and spots Pluto TV", () => {
    const [x, y] = parseM3u(`#EXTINF:-1 tvg-id="Novelas.us@LatAm" tvg-logo="https://images.pluto.tv/x.png",Pluto Novelas
https://p.example/a.m3u8
#EXTINF:-1 tvg-country="AR" tvg-id="Canal.uk",Canal
https://c.example/b.m3u8`);
    expect(x).toMatchObject({ country: "US", pluto: true });
    expect(y).toMatchObject({ country: "AR", pluto: false });
    expect(countryFlag("MX")).toBe("🇲🇽");
  });
});

describe("adult groups in a mixed list", () => {
  const MIXED = `#EXTM3U
#EXTINF:-1 group-title="News",Noticias 24
https://n.example/a.m3u8
#EXTINF:-1 group-title="XXX",Canal X
https://x.example/b.m3u8
#EXTINF:-1 group-title="Adultos;Movies",Cine nocturno
https://x.example/c.m3u8
#EXTINF:-1 group-title="Kids",Caricaturas
https://k.example/d.m3u8
`;
  const visible = () =>
    parseM3u(MIXED)
      .filter((c) => !c.groups.some(hideAdult.group) && !hideAdult.group(c.name))
      .map((c) => c.name);

  it("hides +18 groups unless the profile allows them", () => {
    setAdultAllowed(false);
    expect(visible()).toEqual(["Noticias 24", "Caricaturas"]);
    setAdultAllowed(true);
    expect(visible()).toEqual(["Noticias 24", "Canal X", "Cine nocturno", "Caricaturas"]);
    setAdultAllowed(false);
  });
});
