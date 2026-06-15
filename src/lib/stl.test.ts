import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { meshToBinarySTL } from "./stl";
import type { Mesh } from "./shape";

const oneTriangle: Mesh = {
  vertices: [
    { x: 1, y: 2, z: 3 },
    { x: 4, y: 5, z: 6 },
    { x: 7, y: 8, z: 9 },
  ],
  faces: [{ a: 0, b: 1, c: 2, normal: { x: 0, y: 1, z: 0 }, color: { r: 1, g: 1, b: 1 } }],
};

describe("meshToBinarySTL", () => {
  it("produces the right byte length (84 + 50*faces)", () => {
    const buf = meshToBinarySTL(oneTriangle, 1);
    expect(buf.length).toBe(84 + 50 * 1);
  });

  it("writes the triangle count at offset 80", () => {
    const buf = meshToBinarySTL(oneTriangle, 1);
    expect(buf.readUInt32LE(80)).toBe(1);
  });

  it("swaps y/z and scales vertices but NOT the normal", () => {
    const buf = meshToBinarySTL(oneTriangle, 2);
    // facet record starts at offset 84: normal(3 floats), then 3 vertices(3 floats each)
    // normal {0,1,0} written x,z,y => 0,0,1, UNSCALED
    expect(buf.readFloatLE(84)).toBeCloseTo(0);
    expect(buf.readFloatLE(88)).toBeCloseTo(0);
    expect(buf.readFloatLE(92)).toBeCloseTo(1);
    // vertex a {1,2,3} scaled x2 then written x,z,y => 2,6,4
    expect(buf.readFloatLE(96)).toBeCloseTo(2);
    expect(buf.readFloatLE(100)).toBeCloseTo(6);
    expect(buf.readFloatLE(104)).toBeCloseTo(4);
  });
});
