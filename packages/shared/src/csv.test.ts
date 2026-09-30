import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvField('Mr. "Mime", Jr.')).toBe('"Mr. ""Mime"", Jr."');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });
  it("leaves numbers and empties alone", () => {
    expect(csvField(3)).toBe("3");
    expect(csvField(null)).toBe("");
  });
  it("defuses spreadsheet formulas in text", () => {
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(-5)).toBe("-5");
  });
  it("joins rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });
});
