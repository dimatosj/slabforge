import { describe, it, expect } from "vitest";
import golden from "../../test-fixtures/golden-geometry.json";
import makeShape, { convertUnits } from "./shape";

type Vec3 = { x: number; y: number; z: number };

function expectVecClose(actual: Vec3, expected: Vec3, label: string) {
  expect(actual.x, `${label}.x`).toBeCloseTo(expected.x, 6);
  expect(actual.y, `${label}.y`).toBeCloseTo(expected.y, 6);
  expect(actual.z, `${label}.z`).toBeCloseTo(expected.z, 6);
}

describe("convertUnits mm", () => {
  it("converts cm to mm exactly (factor 10)", () => {
    expect(convertUnits(5, "cm", "mm")).toBeCloseTo(50, 9);
  });
  it("converts in to mm (~25.4 mm/in via the pt pivot)", () => {
    expect(convertUnits(5, "in", "mm")).toBeCloseTo(126.984, 2);
  });
  it("round-trips mm through pt", () => {
    expect(convertUnits(convertUnits(7, "mm", "pt"), "pt", "mm")).toBeCloseTo(7, 9);
  });
});

describe("makeShape golden output", () => {
  for (const c of golden as any[]) {
    const p = c.params;
    it(`matches golden for ${JSON.stringify(p)}`, () => {
      const shape = makeShape(p.sides, p.height, p.bottomWidth, p.topWidth, p.clayThickness, p.seamMode, p.units);

      // SVG path strings must be byte-identical
      expect(shape.calcWalls()).toEqual(c.walls);
      expect(shape.calcCreaseMarkers()).toEqual(c.creases);
      expect(shape.calcBevelMarkers()).toEqual(c.bevelMarkers);
      expect(shape.calcPDFBounds()).toEqual(c.pdfBounds);
      expect(shape.bevelAngleDegrees ?? null).toEqual(c.bevelAngleDegrees);

      // Mesh: counts exact, coordinates/normals close
      const mesh = shape.calc3DGeometry();
      expect(mesh.vertices.length).toEqual(c.mesh.vertices.length);
      expect(mesh.faces.length).toEqual(c.mesh.faces.length);
      mesh.vertices.forEach((v, i) => expectVecClose(v, c.mesh.vertices[i], `v[${i}]`));
      mesh.faces.forEach((f, i) => {
        expect(f.a, `f[${i}].a`).toEqual(c.mesh.faces[i].a);
        expect(f.b, `f[${i}].b`).toEqual(c.mesh.faces[i].b);
        expect(f.c, `f[${i}].c`).toEqual(c.mesh.faces[i].c);
        expectVecClose(f.normal, c.mesh.faces[i].normal, `f[${i}].normal`);
      });

      // Highlight lines
      for (const target of Object.keys(c.highlights)) {
        const hl = shape.calcHighlightGeometry(target).vertices;
        expect(hl.length).toEqual(c.highlights[target].length);
        hl.forEach((v, i) => expectVecClose(v, c.highlights[target][i], `hl[${target}][${i}]`));
      }
    });
  }
});
