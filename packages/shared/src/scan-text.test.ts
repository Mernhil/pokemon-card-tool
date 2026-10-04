import { describe, expect, it } from "vitest";
import { parseScannedNumbers } from "./scan-text";

describe("parseScannedNumbers", () => {
  it("reads number/total, ignoring the rest of the line", () => {
    expect(parseScannedNumbers("Illus. Mitsuhiro Arita  025/198 ◆ R")).toEqual([
      { number: "025", total: "198" },
    ]);
  });
  it("repairs letters OCR mistook for digits", () => {
    expect(parseScannedNumbers("O25/I98")).toEqual([{ number: "025", total: "198" }]);
  });
  it("reads galleries and promos", () => {
    expect(parseScannedNumbers("TG01/TG30")).toEqual([{ number: "TG01", total: "TG30" }]);
    expect(parseScannedNumbers("SVP 123 Pokemon")).toEqual([{ number: "SVP123", total: null }]);
  });
  it("finds nothing in plain text", () => {
    expect(parseScannedNumbers("Charizard HP 120 Fire")).toEqual([]);
  });
});
