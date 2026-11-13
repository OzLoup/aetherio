import { beforeAll, describe, expect, it, vi } from "vitest";

// No browser in these tests: a window with just the history entry's state.
const fakeHistory = { state: null as unknown, replaceState(state: unknown) { this.state = state; } };
vi.stubGlobal("window", { history: fakeHistory });
vi.mock("@/lib/spatialNav", () => ({ setPageBack: () => () => {} }));

let stepsBackTo: typeof import("./backNav").stepsBackTo;
let trackEntry: typeof import("./backNav").trackEntry;
beforeAll(async () => {
  ({ stepsBackTo, trackEntry } = await import("./backNav"));
});

function at(idx: number, pathname: string) {
  fakeHistory.replaceState({ idx });
  trackEntry(pathname);
}

describe("back follows the title", () => {
  it("from the player to the title's page, skipping the sources list", () => {
    at(0, "/");
    at(1, "/detail/series/tt1");
    at(2, "/streams/series/tt1:1:2");
    at(3, "/play/series/tt1:1:2");
    expect(stepsBackTo(["detail", "page"])).toBe(2);
  });

  it("from a title's page to the list, skipping other titles", () => {
    at(0, "/discover");
    at(1, "/detail/movie/tt1");
    at(2, "/detail/movie/tt2"); // a similar one
    at(3, "/streams/movie/tt2");
    at(4, "/detail/movie/tt2");
    expect(stepsBackTo(["page"])).toBe(4);
  });

  it("doesn't guess when the history before is unknown (after a reload)", () => {
    fakeHistory.replaceState({ idx: 40 });
    expect(stepsBackTo(["page"])).toBeNull();
  });
});
