import { Buffer } from "node:buffer";
import type { RequestHandler } from "./$types";
import makeShape, { type Vec3 } from "$lib/shape";

function writeVector(buffer: Buffer, vector: Vec3, position: number): number {
  // STL viewers use z-up; three/our math use y-up, so swap y and z.
  position = buffer.writeFloatLE(vector.x, position);
  position = buffer.writeFloatLE(vector.z, position);
  position = buffer.writeFloatLE(vector.y, position);
  return position;
}

export const GET: RequestHandler = ({ url }) => {
  const p = Object.fromEntries(url.searchParams.entries());
  const shape = makeShape(
    p.sides === "∞" ? "∞" : Number(p.sides),
    p.height,
    p.bottomWidth,
    p.topWidth,
    p.clayThickness,
    p.seamMode,
    p.units as any
  );

  const geometry = shape.calc3DGeometry();
  const headerBytes = 80 + 4;
  const triangleBytes = (4 * 3 * 4 + 2) * geometry.faces.length;
  const result = Buffer.alloc(headerBytes + triangleBytes);

  let position = 80;
  position = result.writeUInt32LE(geometry.faces.length, position);
  for (const face of geometry.faces) {
    position = writeVector(result, face.normal, position);
    position = writeVector(result, geometry.vertices[face.a], position);
    position = writeVector(result, geometry.vertices[face.b], position);
    position = writeVector(result, geometry.vertices[face.c], position);
    position = result.writeUInt16LE(0, position);
  }

  const type = p.sides === "∞" ? "circle" : "prism-" + p.sides;
  const filename = `slabforge-${type}-${p.height}-${p.bottomWidth}-${p.topWidth}-${p.clayThickness}-${p.units}.stl`;
  return new Response(result, {
    headers: {
      "Content-Type": "model/x.stl-binary",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
