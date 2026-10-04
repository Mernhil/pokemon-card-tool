import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { normalizeCondition, normalizeFinish, parseCollectionCsv } from "./collection-import";

describe("parseCsv", () => {
  it("handles quotes, embedded newlines, BOM, CRLF and guesses the delimiter", () => {
    expect(parseCsv('﻿a;b\r\n"x;y";"he said ""hi"""\r\n\r\n1;2\r\n')).toEqual([
      ["a", "b"],
      ["x;y", 'he said "hi"'],
      ["1", "2"],
    ]);
    expect(parseCsv('a,b\n"line\nbreak",2')).toEqual([["a", "b"], ["line\nbreak", "2"]]);
  });
});

describe("parseCollectionCsv", () => {
  it("reads a Cardmarket-style export", () => {
    const { rows, warnings } = parseCollectionCsv(
      "Name,Expansion,Number,Language,Condition,Foil,Amount,Price\n" +
        'Charizard,Base Set,4,English,NM,Yes,2,"1.234,50"\n' +
        "Pikachu,Jungle,60,German,LP,,1,3\n",
    );
    expect(warnings).toEqual([]);
    expect(rows[0]).toMatchObject({
      name: "Charizard",
      set: "Base Set",
      number: "4",
      quantity: 2,
      foil: true,
      condition: "NEAR_MINT",
      language: "en",
      paid: 1234.5,
    });
    expect(rows[1]).toMatchObject({ foil: null, condition: "LIGHTLY_PLAYED", language: "de", paid: 3 });
  });

  it("reads our own export and a Collectr-style one", () => {
    const own = parseCollectionCsv("Set,Number,Name,Finish,Quantity,Condition\nBase Set,004/102,Charizard,HOLO,1,NEAR_MINT\n");
    expect(own.rows[0]).toMatchObject({ finish: "HOLO", foil: true, condition: "NEAR_MINT" });
    const collectr = parseCollectionCsv(
      "Set,Product Name,Card Number,Variance,Card Condition,Average Cost Paid,Quantity\nJungle,Pikachu,60/64,Reverse Holofoil,Near Mint,2.5,3\n",
    );
    expect(collectr.rows[0]).toMatchObject({ finish: "REVERSE_HOLO", quantity: 3, paid: 2.5 });
  });

  it("warns about missing columns and bad quantities", () => {
    expect(parseCollectionCsv("Foo,Bar\n1,2\n").warnings[0]).toMatch(/Name/);
    const r = parseCollectionCsv("Name,Number,Qty\nPikachu,1,0\nRaichu,2,1\n");
    expect(r.rows.map((x) => x.name)).toEqual(["Raichu"]);
    expect(r.warnings[0]).toMatch(/Line 2/);
  });

  it("normalizes conditions and finishes", () => {
    expect(normalizeCondition("Slightly Played")).toBe("LIGHTLY_PLAYED");
    expect(normalizeCondition("whatever")).toBeNull();
    expect(normalizeFinish("Reverse Holofoil")).toBe("REVERSE_HOLO");
    expect(normalizeFinish("Normal")).toBe("NON_FOIL");
    expect(normalizeFinish("1st Edition")).toBeNull();
  });
});
