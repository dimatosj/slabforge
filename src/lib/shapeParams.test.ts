import { describe, it, expect } from "vitest";
import { parseShapeParams, ShapeParamError } from "./shapeParams";

function q(s: string) {
  return new URLSearchParams(s);
}
const valid = "sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter";

describe("parseShapeParams", () => {
  it("parses a valid prism query", () => {
    const p = parseShapeParams(q(valid));
    expect(p).toEqual({
      sides: 4, height: 5, bottomWidth: 5, topWidth: 5,
      clayThickness: 0.25, seamMode: "sides", units: "in", pageSize: "letter",
    });
  });
  it("accepts the infinity (circle) sides token", () => {
    expect(parseShapeParams(q(valid.replace("sides=4", "sides=∞"))).sides).toBe("∞");
  });
  it("defaults pageSize to letter when absent", () => {
    expect(parseShapeParams(q("sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in")).pageSize).toBe("letter");
  });
  it.each([
    ["sides below range", valid.replace("sides=4", "sides=2")],
    ["sides above range", valid.replace("sides=4", "sides=25")],
    ["non-integer sides", valid.replace("sides=4", "sides=4.5")],
    ["zero height", valid.replace("height=5", "height=0")],
    ["negative width", valid.replace("bottomWidth=5", "bottomWidth=-3")],
    ["non-numeric clay", valid.replace("clayThickness=0.25", "clayThickness=abc")],
    ["missing topWidth", "sides=4&height=5&bottomWidth=5&clayThickness=0.25&seamMode=sides&units=in"],
    ["bad seamMode", valid.replace("seamMode=sides", "seamMode=diagonal")],
    ["bad units", valid.replace("units=in", "units=furlongs")],
    ["bad pageSize", valid.replace("pageSize=letter", "pageSize=billboard")],
  ])("throws ShapeParamError for %s", (_label, query) => {
    expect(() => parseShapeParams(q(query))).toThrow(ShapeParamError);
  });
});
