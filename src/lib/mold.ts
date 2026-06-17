import { convertUnits, faceNormal, type Units, type Mesh, type Vec3, type Face, type Color } from "./shape";

const CIRCLE_RESOLUTION = 100;
const WHITE: Color = { r: 1, g: 1, b: 1 };

export interface MoldParams {
  sides: number | "∞";
  height: number;
  bottomWidth: number;
  topWidth: number;
  clayThickness: number;
  units: Units;
}

function sides(p: MoldParams): number {
  return p.sides === "∞" ? CIRCLE_RESOLUTION : p.sides;
}

// Interior circumradius for a width, matching shape.ts doMath convention.
function circumradius(width: number, n: number): number {
  return width / 2 / Math.cos(Math.PI / n);
}

// Hump/drape mold: a solid positive frustum of the interior, widest-end-down
// (flat base at y=0) so a draped slab releases upward.
export function buildHumpMold(p: MoldParams): Mesh {
  const n = sides(p);
  const rb = circumradius(p.bottomWidth, n);
  const rt = circumradius(p.topWidth, n);
  const rWide = Math.max(rb, rt);
  const rNarrow = Math.min(rb, rt);
  const h = p.height;

  const vertices: Vec3[] = [];
  const v = (x: number, y: number, z: number) => (vertices.push({ x, y, z }), vertices.length - 1);
  const bottomCenter = v(0, 0, 0);
  const topCenter = v(0, h, 0);
  const bottom: number[] = [];
  const top: number[] = [];
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / n;
    bottom.push(v(rWide * Math.cos(th), 0, rWide * Math.sin(th)));
    top.push(v(rNarrow * Math.cos(th), h, rNarrow * Math.sin(th)));
  }

  const faces: Face[] = [];
  const tri = (a: number, b: number, c: number) =>
    faces.push({ a, b, c, color: WHITE, normal: faceNormal(vertices[a], vertices[b], vertices[c]) });
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    tri(bottomCenter, bottom[k], bottom[k1]); // bottom cap (normal -y)
    tri(topCenter, top[k1], top[k]); // top cap (normal +y)
    tri(bottom[k], top[k1], bottom[k1]); // side
    tri(bottom[k], top[k], top[k1]); // side
  }
  return { vertices, faces };
}

// Slump mold: a prismatic block with a frustum cavity of the exterior, cavity
// mouth (widest) up at the block top so a pressed slab releases.
export function buildSlumpMold(p: MoldParams): Mesh {
  const n = sides(p);
  const rb = circumradius(p.bottomWidth, n) + p.clayThickness; // exterior
  const rt = circumradius(p.topWidth, n) + p.clayThickness;
  const rWide = Math.max(rb, rt); // cavity mouth (top)
  const rNarrow = Math.min(rb, rt); // cavity floor (bottom)
  const margin = p.clayThickness;
  const outerR = rWide + margin;
  const base = convertUnits(1, "cm", p.units); // solid base thickness below the cavity
  const totalH = p.height + base;

  const vertices: Vec3[] = [];
  const v = (x: number, y: number, z: number) => (vertices.push({ x, y, z }), vertices.length - 1);
  const bottomCenter = v(0, 0, 0);
  const floorCenter = v(0, base, 0);
  const outerBottom: number[] = [];
  const outerTop: number[] = [];
  const mouth: number[] = [];
  const floor: number[] = [];
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / n;
    const c = Math.cos(th), s = Math.sin(th);
    outerBottom.push(v(outerR * c, 0, outerR * s));
    outerTop.push(v(outerR * c, totalH, outerR * s));
    mouth.push(v(rWide * c, totalH, rWide * s));
    floor.push(v(rNarrow * c, base, rNarrow * s));
  }

  const faces: Face[] = [];
  const tri = (a: number, b: number, c: number) =>
    faces.push({ a, b, c, color: WHITE, normal: faceNormal(vertices[a], vertices[b], vertices[c]) });
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    tri(bottomCenter, outerBottom[k], outerBottom[k1]); // outer bottom cap (-y)
    tri(outerBottom[k], outerBottom[k1], outerTop[k1]); // outer wall
    tri(outerBottom[k], outerTop[k1], outerTop[k]);
    tri(outerTop[k], outerTop[k1], mouth[k1]); // top rim (+y)
    tri(outerTop[k], mouth[k1], mouth[k]);
    tri(mouth[k], mouth[k1], floor[k1]); // cavity wall (inward)
    tri(mouth[k], floor[k1], floor[k]);
    tri(floorCenter, floor[k1], floor[k]); // cavity floor (+y, up into cavity)
  }
  return { vertices, faces };
}
