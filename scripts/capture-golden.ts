// Run against the EXISTING src/lib/shape.js (three.js 0.124) to record golden
// outputs. Run with: npx tsx scripts/capture-golden.ts
import { writeFileSync } from "node:fs";
// @ts-ignore - legacy JS module, no types
import makeShape from "../src/lib/shape.js";

const CASES = [
  { sides: 4, height: 5, bottomWidth: 5, topWidth: 5, clayThickness: 0.25, seamMode: "sides", units: "in" },
  { sides: 3, height: 6, bottomWidth: 4, topWidth: 2, clayThickness: 0.3, seamMode: "sides", units: "in" },
  { sides: 6, height: 5, bottomWidth: 5, topWidth: 8, clayThickness: 0.25, seamMode: "base", units: "cm" },
  { sides: 4, height: 10, bottomWidth: 3, topWidth: 3, clayThickness: 0.5, seamMode: "base", units: "in" },
  { sides: 5, height: 5, bottomWidth: 5, topWidth: 5, clayThickness: 0.25, seamMode: "sides", units: "in" },
  { sides: "∞", height: 5, bottomWidth: 5, topWidth: 5, clayThickness: 0.25, seamMode: "base", units: "in" },
  { sides: "∞", height: 8, bottomWidth: 4, topWidth: 7, clayThickness: 0.25, seamMode: "base", units: "cm" },
];

const HIGHLIGHTS = ["height", "topWidth", "bottomWidth", "clayThickness", ""];

function vec(v: any) {
  return { x: v.x, y: v.y, z: v.z };
}

const out = CASES.map((p) => {
  const shape = makeShape(p.sides, p.height, p.bottomWidth, p.topWidth, p.clayThickness, p.seamMode, p.units);
  const geo = shape.calc3DGeometry();
  const mesh = {
    vertices: geo.vertices.map(vec),
    faces: geo.faces.map((f: any) => ({ a: f.a, b: f.b, c: f.c, normal: vec(f.normal) })),
  };
  const highlights: Record<string, { x: number; y: number; z: number }[]> = {};
  for (const t of HIGHLIGHTS) {
    highlights[t] = shape.calcHighlightGeometry(t).vertices.map(vec);
  }
  return {
    params: p,
    walls: shape.calcWalls(),
    creases: shape.calcCreaseMarkers(),
    bevelMarkers: shape.calcBevelMarkers(),
    pdfBounds: shape.calcPDFBounds(),
    bevelAngleDegrees: shape.bevelAngleDegrees ?? null,
    mesh,
    highlights,
  };
});

writeFileSync(new URL("../test-fixtures/golden-geometry.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`wrote ${out.length} golden cases`);
