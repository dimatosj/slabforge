import { describe, it, expect } from "vitest";
import makeShape from "./shape";
import {
  DEFAULT_PARAMS,
  serializeDesign,
  parseDesignQuery,
  convertValue,
  estimatePageCount,
} from "./design";

describe("serializeDesign / parseDesignQuery", () => {
  it("round-trips a design", () => {
    const p = { ...DEFAULT_PARAMS, sides: 6, units: "cm", seamMode: "base", pageSize: "auto" } as const;
    expect(parseDesignQuery(serializeDesign(p))).toEqual(p);
  });
  it("round-trips the infinity sides token", () => {
    const p = { ...DEFAULT_PARAMS, sides: "∞", seamMode: "base" } as const;
    expect(parseDesignQuery(serializeDesign(p))).toEqual(p);
  });
  it("returns null for an invalid query", () => {
    expect(
      parseDesignQuery("sides=2&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in")
    ).toBeNull();
  });
  it("returns null for an empty query", () => {
    expect(parseDesignQuery("")).toBeNull();
  });
});

describe("convertValue", () => {
  it("round-trips clay thickness in->cm->in without drift", () => {
    expect(convertValue(convertValue(0.25, "in", "cm"), "cm", "in")).toBe(0.25);
  });
  it("round-trips 5 in", () => {
    expect(convertValue(convertValue(5, "in", "cm"), "cm", "in")).toBe(5);
  });
});

describe("estimatePageCount", () => {
  it("auto is always one page", () => {
    const shape = makeShape(4, 5, 5, 5, 0.25, "sides", "in");
    expect(estimatePageCount(shape, "in", "auto")).toBe(1);
  });
  it("returns a positive integer for letter", () => {
    const shape = makeShape(4, 5, 5, 5, 0.25, "sides", "in");
    const n = estimatePageCount(shape, "in", "letter");
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });
  it("a large shape needs more than one letter page", () => {
    const shape = makeShape(4, 40, 40, 40, 0.5, "sides", "in");
    expect(estimatePageCount(shape, "in", "letter")).toBeGreaterThan(1);
  });
});
