import { Buffer } from "node:buffer";
import type { Mesh, Vec3 } from "./shape";

// STL viewers/slicers use z-up while our math is y-up, so we swap y and z.
// `scale` multiplies vertex POSITIONS (e.g. design units -> mm). A facet normal
// is a unit direction; a uniform positive scale leaves it unit-length, so it is
// written unscaled.
function writeVector(buffer: Buffer, v: Vec3, position: number, scale: number): number {
  position = buffer.writeFloatLE(v.x * scale, position);
  position = buffer.writeFloatLE(v.z * scale, position);
  position = buffer.writeFloatLE(v.y * scale, position);
  return position;
}

export function meshToBinarySTL(mesh: Mesh, scale: number): Buffer {
  const headerBytes = 80 + 4;
  const triangleBytes = (4 * 3 * 4 + 2) * mesh.faces.length;
  const result = Buffer.alloc(headerBytes + triangleBytes);

  let position = 80;
  position = result.writeUInt32LE(mesh.faces.length, position);
  for (const face of mesh.faces) {
    position = writeVector(result, face.normal, position, 1); // normal: unscaled
    position = writeVector(result, mesh.vertices[face.a], position, scale);
    position = writeVector(result, mesh.vertices[face.b], position, scale);
    position = writeVector(result, mesh.vertices[face.c], position, scale);
    position = result.writeUInt16LE(0, position);
  }
  return result;
}
