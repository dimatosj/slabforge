import { Buffer } from "node:buffer";
import type { Mesh, Vec3 } from "./shape";

// A closed 2-manifold ("watertight") mesh has every undirected edge shared by
// exactly two triangles. Returns false if any edge is used once (a hole) or
// three+ times (non-manifold).
export function isWatertight(mesh: Mesh): boolean {
  const edges = new Map<string, number>();
  const key = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  for (const f of mesh.faces) {
    for (const [i, j] of [
      [f.a, f.b],
      [f.b, f.c],
      [f.c, f.a],
    ]) {
      const k = key(i, j);
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  if (edges.size === 0) return false;
  for (const count of edges.values()) {
    if (count !== 2) return false;
  }
  return true;
}

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
