import { describe, expect, it } from "vitest";
import { matchChecklistCard, parseChecklistEntry, pickChecklistFinish } from "./checklist";

describe("parseChecklistEntry", () => {
  it("reads a number, optionally with a count", () => {
    expect(parseChecklistEntry(" 25 ")).toEqual({ number: "25", quantity: 1 });
    expect(parseChecklistEntry("25x3")).toEqual({ number: "25", quantity: 3 });
    expect(parseChecklistEntry("25 * 2")).toEqual({ number: "25", quantity: 2 });
    expect(parseChecklistEntry("TG01")).toEqual({ number: "TG01", quantity: 1 });
    expect(parseChecklistEntry("SVP 123")).toEqual({ number: "SVP 123", quantity: 1 });
  });
  it("ignores empty input and a bare count", () => {
    expect(parseChecklistEntry("  ")).toBeNull();
    expect(parseChecklistEntry("x3")).toEqual({ number: "x3", quantity: 1 });
    expect(parseChecklistEntry("5x0")).toBeNull();
  });
});

describe("matchChecklistCard", () => {
  const cards = [
    { id: "a", number: "025/198" },
    { id: "b", number: "TG01/TG30" },
    { id: "c", number: "SVP 123" },
    { id: "d", number: "26/198" },
  ];
  it("matches numerically, exactly, and ignoring case and spaces", () => {
    expect(matchChecklistCard(cards, "25")?.id).toBe("a");
    expect(matchChecklistCard(cards, "025")?.id).toBe("a");
    expect(matchChecklistCard(cards, "tg01")?.id).toBe("b");
    expect(matchChecklistCard(cards, "svp123")?.id).toBe("c");
    expect(matchChecklistCard(cards, "26")?.id).toBe("d");
  });
  it("finds nothing for an unknown or ambiguous number", () => {
    expect(matchChecklistCard(cards, "99")).toBeNull();
    expect(matchChecklistCard([...cards, { id: "e", number: "025/198" }], "25")).toBeNull();
  });
});

describe("pickChecklistFinish", () => {
  it("uses the chosen finish when the card has it, else its plainest", () => {
    expect(pickChecklistFinish(["NON_FOIL", "REVERSE_HOLO"], "REVERSE_HOLO")).toBe("REVERSE_HOLO");
    expect(pickChecklistFinish(["HOLO", "FIRST_EDITION:HOLO"], "REVERSE_HOLO")).toBe("HOLO");
    expect(pickChecklistFinish([], "HOLO")).toBeNull();
  });
});
