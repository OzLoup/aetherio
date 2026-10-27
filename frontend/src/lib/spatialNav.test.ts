import { describe, expect, it } from "vitest";
import { _internal } from "./spatialNav";

function box(name: string, left: number, top: number, w = 100, h = 150) {
  // Just what the scoring reads (tests run without a DOM).
  const rect = { left, top, right: left + w, bottom: top + h, width: w, height: h };
  const el = { textContent: name, getBoundingClientRect: () => rect, contains: (o: unknown) => o === el };
  return el as unknown as HTMLElement;
}

// Two poster rows; the second one is shorter and starts further left.
const row1 = [box("a", 0, 0), box("b", 120, 0), box("c", 240, 0), box("d", 360, 0)];
const row2 = [box("e", 0, 200), box("f", 120, 200)];
const navbar = [box("home", 0, -100, 60, 30), box("search", 300, -100, 60, 30)];
const all = [...navbar, ...row1, ...row2];
const go = (from: HTMLElement, dir: "up" | "down" | "left" | "right") =>
  _internal.best(from.getBoundingClientRect(), all, dir, from)?.textContent;

describe("remote navigation", () => {
  it("moves along a row", () => {
    expect(go(row1[1], "right")).toBe("c");
    expect(go(row1[1], "left")).toBe("a");
    expect(go(row1[0], "left")).toBeUndefined();
  });
  it("goes down to the same column, or the nearest one", () => {
    expect(go(row1[1], "down")).toBe("f");
    expect(go(row1[3], "down")).toBe("f");
  });
  it("goes up to the navbar item above", () => {
    expect(go(row1[2], "up")).toBe("search");
    expect(go(row2[0], "up")).toBe("a");
  });
});
