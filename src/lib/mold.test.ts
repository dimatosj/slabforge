import { describe, it, expect } from "vitest";
import { isWatertight } from "./stl";
import { buildHumpMold, buildSlumpMold } from "./mold";

const prism = { sides: 6, height: 5, bottomWidth: 5, topWidth: 8, clayThickness: 0.25, units: "in" } as const;
const circle = { sides: "∞", height: 5, bottomWidth: 5, topWidth: 5, clayThickness: 0.25, units: "in" } as const;

function lowestY(m: { vertices: { y: number }[] }) {
  return Math.min(...m.vertices.map((v) => v.y));
}

describe("buildHumpMold", () => {
  it("is watertight for prism and circle", () => {
    expect(isWatertight(buildHumpMold(prism))).toBe(true);
    expect(isWatertight(buildHumpMold(circle))).toBe(true);
  });
  it("has a flat base at y=0", () => {
    expect(lowestY(buildHumpMold(prism))).toBeCloseTo(0, 9);
  });
  it("base ring radius equals the wider interior circumradius", () => {
    const n = 6;
    const rb = 5 / 2 / Math.cos(Math.PI / n);
    const rt = 8 / 2 / Math.cos(Math.PI / n);
    const rWide = Math.max(rb, rt);
    const m = buildHumpMold(prism);
    const baseR = Math.max(
      ...m.vertices.filter((v) => Math.abs(v.y) < 1e-9).map((v) => Math.hypot(v.x, v.z))
    );
    expect(baseR).toBeCloseTo(rWide, 6);
  });
  it("every face normal points outward (convex hump)", () => {
    const m = buildHumpMold(prism);
    const c = m.vertices.reduce((s, v) => ({ x: s.x + v.x, y: s.y + v.y, z: s.z + v.z }), { x: 0, y: 0, z: 0 });
    c.x /= m.vertices.length; c.y /= m.vertices.length; c.z /= m.vertices.length;
    for (const f of m.faces) {
      const va = m.vertices[f.a], vb = m.vertices[f.b], vc = m.vertices[f.c];
      const cen = { x: (va.x + vb.x + vc.x) / 3, y: (va.y + vb.y + vc.y) / 3, z: (va.z + vb.z + vc.z) / 3 };
      const out = { x: cen.x - c.x, y: cen.y - c.y, z: cen.z - c.z };
      expect(f.normal.x * out.x + f.normal.y * out.y + f.normal.z * out.z).toBeGreaterThan(0);
    }
  });
});

describe("buildSlumpMold", () => {
  it("is watertight for prism and circle", () => {
    expect(isWatertight(buildSlumpMold(prism))).toBe(true);
    expect(isWatertight(buildSlumpMold(circle))).toBe(true);
  });
  it("has a flat base at y=0", () => {
    expect(lowestY(buildSlumpMold(prism))).toBeCloseTo(0, 9);
  });
  it("outer radius exceeds the cavity mouth (block surrounds the cavity)", () => {
    const n = 6, t = 0.25;
    const rt = 8 / 2 / Math.cos(Math.PI / n) + t;
    const rb = 5 / 2 / Math.cos(Math.PI / n) + t;
    const rWide = Math.max(rb, rt);
    const m = buildSlumpMold(prism);
    const outerR = Math.max(...m.vertices.map((v) => Math.hypot(v.x, v.z)));
    expect(outerR).toBeGreaterThan(rWide);
  });
});
