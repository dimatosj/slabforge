# Fabrication Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee true print scale + alignable tiled pages in the PDF, finish the assembly diagram, replace the unusable slump-mold export with real watertight hump & slump molds (user-selectable), and add a manifold audit.

**Architecture:** A new pure `src/lib/mold.ts` builds watertight mold meshes consumed by the existing `meshToBinarySTL`; an `isWatertight` helper in `stl.ts` backs a manifold audit; PDF draw helpers are added to `shape.pdf/+server.ts`; the mold endpoint gains a `moldType` param and the editor offers two mold links.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Vitest, Playwright, pdfkit. Work from `/Users/jsd/projects/slabforge` on branch `fabrication-fidelity`.

**Spec:** `docs/superpowers/specs/2026-06-17-fabrication-fidelity-design.md`

---

## File Structure

- **Modify** `src/lib/shape.ts` — `export` the existing `faceNormal` helper (so `mold.ts` reuses it); possible vessel winding fix in Task 4.
- **Create** `src/lib/mold.ts` (+ `src/lib/mold.test.ts`) — `buildHumpMold`, `buildSlumpMold`.
- **Modify** `src/lib/stl.ts` (+ `src/lib/stl.test.ts`) — `isWatertight`.
- **Modify** `src/routes/slump-mold.stl/+server.ts` — `moldType` param → mold builders.
- **Modify** `src/routes/edit/+page.svelte` — two mold download links.
- **Modify** `src/routes/shape.pdf/+server.ts` — scale-check ruler, registration marks, assembly diagram.
- **Modify** `e2e/edit.test.ts` — mold links + PDF regression.

---

## Task 1: `isWatertight` manifold helper

**Files:**
- Modify: `src/lib/stl.ts`
- Modify: `src/lib/stl.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/stl.test.ts` (keep existing imports/tests; add `isWatertight` to the import from `./stl`):

```ts
import { isWatertight } from "./stl";

describe("isWatertight", () => {
  // A closed tetrahedron: 4 vertices, 4 triangular faces.
  const tetra = {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    faces: [
      { a: 0, b: 2, c: 1, normal: { x: 0, y: 0, z: -1 }, color: { r: 1, g: 1, b: 1 } },
      { a: 0, b: 1, c: 3, normal: { x: 0, y: -1, z: 0 }, color: { r: 1, g: 1, b: 1 } },
      { a: 0, b: 3, c: 2, normal: { x: -1, y: 0, z: 0 }, color: { r: 1, g: 1, b: 1 } },
      { a: 1, b: 2, c: 3, normal: { x: 1, y: 1, z: 1 }, color: { r: 1, g: 1, b: 1 } },
    ],
  };

  it("returns true for a closed tetrahedron", () => {
    expect(isWatertight(tetra)).toBe(true);
  });

  it("returns false when a face is missing (open mesh)", () => {
    const open = { vertices: tetra.vertices, faces: tetra.faces.slice(0, 3) };
    expect(isWatertight(open)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `isWatertight` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/stl.ts` (after the imports, before or after `meshToBinarySTL`):

```ts
import type { Mesh } from "./shape";

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
```
(If `stl.ts` already imports `Mesh`, reuse that import rather than adding a duplicate.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit`
Expected: PASS (the two `isWatertight` tests + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stl.ts src/lib/stl.test.ts
git commit -m "feat: add isWatertight manifold-check helper"
```

---

## Task 2: Mold geometry — `src/lib/mold.ts`

**Files:**
- Modify: `src/lib/shape.ts` (export `faceNormal`)
- Create: `src/lib/mold.ts`
- Create: `src/lib/mold.test.ts`

- [ ] **Step 1: Export `faceNormal` from `shape.ts`**

In `src/lib/shape.ts`, find `function faceNormal(va: Vec3, vb: Vec3, vc: Vec3): Vec3 {` and change it to `export function faceNormal(va: Vec3, vb: Vec3, vc: Vec3): Vec3 {`. No other change.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/mold.test.ts`:

```ts
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
    const rb = 5 / 2 / Math.cos(Math.PI / n); // bottomWidth interior circumradius
    const rt = 8 / 2 / Math.cos(Math.PI / n); // topWidth interior circumradius
    const rWide = Math.max(rb, rt);
    const m = buildHumpMold(prism);
    // the max horizontal radius among base-plane (y=0) vertices
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
    const rt = 8 / 2 / Math.cos(Math.PI / n) + t; // exterior top
    const rb = 5 / 2 / Math.cos(Math.PI / n) + t; // exterior bottom
    const rWide = Math.max(rb, rt);
    const m = buildSlumpMold(prism);
    const outerR = Math.max(...m.vertices.map((v) => Math.hypot(v.x, v.z)));
    expect(outerR).toBeGreaterThan(rWide);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './mold'`.

- [ ] **Step 4: Implement `src/lib/mold.ts`**

```ts
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
    tri(bottom[k], bottom[k1], top[k1]); // side
    tri(bottom[k], top[k1], top[k]); // side
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:unit`
Expected: PASS. If the hump "normals point outward" test fails for some faces, the winding of that face group is reversed — swap the `b`/`c` argument order for those `tri(...)` calls until all hump normals point outward. (The watertight tests are winding-agnostic; only the hump outward-normal test constrains winding, and the hump is convex so the centroid test is valid.)

- [ ] **Step 6: Type-check**

Run: `npm run check`
Expected: 0 errors (`faceNormal`, `Mesh`, `Vec3`, `Face`, `Color`, `Units`, `convertUnits` all exported from `shape.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/shape.ts src/lib/mold.ts src/lib/mold.test.ts
git commit -m "feat: watertight hump and slump mold geometry builders"
```

---

## Task 3: Mold endpoint (`moldType`) + editor links

**Files:**
- Modify: `src/routes/slump-mold.stl/+server.ts` (full replacement)
- Modify: `src/routes/edit/+page.svelte` (the mold download link)

- [ ] **Step 1: Replace `src/routes/slump-mold.stl/+server.ts` entirely**

```ts
import type { RequestHandler } from "./$types";
import { convertUnits } from "$lib/shape";
import { parseShapeParams, ShapeParamError } from "$lib/shapeParams";
import { meshToBinarySTL } from "$lib/stl";
import { buildHumpMold, buildSlumpMold } from "$lib/mold";

export const GET: RequestHandler = ({ url }) => {
  let p;
  try {
    p = parseShapeParams(url.searchParams);
  } catch (e) {
    if (e instanceof ShapeParamError) return new Response(e.message, { status: 400 });
    throw e;
  }

  const moldType = url.searchParams.get("moldType") ?? "hump";
  if (moldType !== "hump" && moldType !== "slump") {
    return new Response('Invalid "moldType": must be "hump" or "slump"', { status: 400 });
  }

  const moldParams = {
    sides: p.sides,
    height: p.height,
    bottomWidth: p.bottomWidth,
    topWidth: p.topWidth,
    clayThickness: p.clayThickness,
    units: p.units,
  };
  const mesh = moldType === "hump" ? buildHumpMold(moldParams) : buildSlumpMold(moldParams);
  const buffer = meshToBinarySTL(mesh, convertUnits(1, p.units, "mm"));
  const body = Uint8Array.from(buffer);

  const type = p.sides === "∞" ? "circle" : "prism-" + p.sides;
  const filename = `slabforge-${type}-${p.height}-${p.bottomWidth}-${p.topWidth}-${p.clayThickness}-${p.units}-${moldType}-mold.stl`;
  return new Response(body, {
    headers: {
      "Content-Type": "model/x.stl-binary",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
```

- [ ] **Step 2: Replace the single mold link in `src/routes/edit/+page.svelte`**

Find:
```svelte
    <a href="/slump-mold.stl?{shapeExportQuery}">Download Slump Mold</a>
```
Replace with:
```svelte
    <a href="/slump-mold.stl?{shapeExportQuery}&moldType=hump">Download Hump Mold</a>
    <a href="/slump-mold.stl?{shapeExportQuery}&moldType=slump">Download Slump Mold</a>
```
(Leave the PDF and STL links above it unchanged.)

- [ ] **Step 3: Type-check + verify endpoint at runtime**

Run: `npm run check` → expect 0 errors.
```bash
npm run build && (PORT=3300 node build & echo $! > /tmp/sf.pid) && sleep 2
Q="sides=6&height=5&bottomWidth=5&topWidth=8&clayThickness=0.25&seamMode=base&units=in"
curl -s -D - -o /tmp/hump.stl "http://localhost:3300/slump-mold.stl?$Q&moldType=hump" | grep -i "content-type\|content-disposition"; echo "hump bytes: $(wc -c < /tmp/hump.stl)"
curl -s -o /tmp/slump.stl "http://localhost:3300/slump-mold.stl?$Q&moldType=slump"; echo "slump bytes: $(wc -c < /tmp/slump.stl)"
curl -s -o /dev/null -w "bad moldType -> %{http_code}\n" "http://localhost:3300/slump-mold.stl?$Q&moldType=banana"
curl -s -o /dev/null -w "default (no moldType) -> %{http_code}\n" "http://localhost:3300/slump-mold.stl?$Q"
kill $(cat /tmp/sf.pid)
```
Expected: hump → `model/x.stl-binary`, filename ending `-hump-mold.stl`, > 84 bytes; slump → > 84 bytes (and larger than hump, more faces); `bad moldType -> 400`; `default (no moldType) -> 200`. Report the byte counts + codes.

- [ ] **Step 4: Commit**

```bash
git add src/routes/slump-mold.stl/+server.ts src/routes/edit/+page.svelte
git commit -m "feat: hump/slump mold export via moldType param + two editor links"
```

---

## Task 4: Vessel manifold audit

**Files:**
- Modify: `src/lib/stl.test.ts`
- Possibly modify: `src/lib/shape.ts` (only if the vessel is not watertight)

- [ ] **Step 1: Add the vessel watertightness assertion**

Append to `src/lib/stl.test.ts` (it already imports `isWatertight`; add `import makeShape from "./shape";` if not present):

```ts
describe("vessel mesh is watertight", () => {
  it.each([
    ["prism sides-seam", () => makeShape(4, 5, 5, 5, 0.25, "sides", "in")],
    ["prism base-seam", () => makeShape(6, 5, 5, 8, 0.25, "base", "cm")],
    ["circle", () => makeShape("∞", 5, 5, 7, 0.25, "base", "in")],
  ])("%s", (_label, make) => {
    expect(isWatertight(make().calc3DGeometry())).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit`
Expected: ideally PASS (the vessel is a closed double-walled tub). If it PASSES, skip Step 3 and go to Step 4.

- [ ] **Step 3: (Only if Step 2 failed) Fix the vessel topology/winding**

If a vessel case is not watertight, inspect `Prism.calc3DGeometry()` / `calc3DVertices()` in `shape.ts`. Determine whether it is (a) a missing-face hole or (b) a duplicated/degenerate edge. Fix minimally so `isWatertight` passes for all three cases, WITHOUT changing vertex positions or face membership in a way that breaks the golden tests (winding/orientation may change; if any face normal flips sign, regenerate the affected golden entries via `npx tsx scripts/capture-golden.ts` and confirm via `git diff` that ONLY normal signs changed). **If the fix requires substantial topology rework (more than reordering/adding a small number of faces), STOP and report DONE_WITH_CONCERNS describing the gap** — the molds (Tasks 2–3) are the primary deliverable and the vessel audit can be split out rather than blocking.

- [ ] **Step 4: Confirm full suite + commit**

Run: `npm run test:unit` → all green. `npm run check` → 0 errors.
```bash
git add -A
git commit -m "test: assert vessel mesh is watertight (manifold audit)"
```
(If Step 3 changed `shape.ts`/golden, those are included in this commit; note it in your report.)

---

## Task 5: PDF print-scale ruler + page registration marks

**Files:**
- Modify: `src/routes/shape.pdf/+server.ts`

- [ ] **Step 1: Add the `drawScaleCheck` helper**

In `src/routes/shape.pdf/+server.ts`, add this function alongside the other draw helpers (e.g. just before `drawInstructions`):

```ts
function drawScaleCheck(doc, x, y) {
  doc.fontSize(fontSize * 0.8);
  doc.text("Print at 100% / Actual Size — do NOT 'Fit to Page'.", x, y);
  doc.text("These bars must measure exactly 1 in and 1 cm:", x, y + fontSize);
  const tick = 3;
  // 1 inch = 72pt
  const inY = y + fontSize * 2.6;
  doc.moveTo(x, inY).lineTo(x + 72, inY).stroke();
  doc.moveTo(x, inY - tick).lineTo(x, inY + tick).stroke();
  doc.moveTo(x + 72, inY - tick).lineTo(x + 72, inY + tick).stroke();
  doc.fontSize(fontSize * 0.7).text("1 in", x, inY + 4);
  // 1 cm = 28.35pt
  const cmY = inY + fontSize * 1.8;
  doc.moveTo(x, cmY).lineTo(x + 28.35, cmY).stroke();
  doc.moveTo(x, cmY - tick).lineTo(x, cmY + tick).stroke();
  doc.moveTo(x + 28.35, cmY - tick).lineTo(x + 28.35, cmY + tick).stroke();
  doc.text("1 cm", x, cmY + 4);
}
```

- [ ] **Step 2: Call it from `drawInstructions`**

In `drawInstructions`, immediately after the `clay thickness` text line (the `.text(\`clay thickness: …\`)` call), add:

```ts
  drawScaleCheck(doc, doc.page.width / 2, doc.page.margins.top);
```
This places the scale check in the top-right area, clear of the top-left parameter list and above the step diagrams (which start at `startY = 1.8` in).

- [ ] **Step 3: Add the `drawRegistrationMarks` helper**

Add alongside the other draw helpers:

```ts
function drawRegistrationMarks(doc, x, y, w, h, row, col) {
  const s = 8;
  doc.save().lineWidth(0.5).strokeColor("black");
  for (const [cx, cy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]) {
    doc.moveTo(cx - s, cy).lineTo(cx + s, cy).stroke();
    doc.moveTo(cx, cy - s).lineTo(cx, cy + s).stroke();
  }
  doc.fontSize(fontSize * 0.7).fillColor("black").text(`R${row} · C${col}`, x + 4, y + 4);
  doc.restore();
}
```

- [ ] **Step 4: Call it in the page loop**

In the `GET` handler's tiling loop, after the `drawTemplate(...)` call and before the `if (pageX < widthPages - 1 …) doc.addPage()`, add:

```ts
      if (widthPages * heightPages > 1) {
        drawRegistrationMarks(doc, pageMargin, pageMargin, pageContentWidth, pageContentHeight, pageY + 1, pageX + 1);
      }
```

- [ ] **Step 5: Verify the PDF renders (production build)**

```bash
npm run build && (PORT=3300 node build & echo $! > /tmp/sf.pid) && sleep 2
# single-page letter
curl -s -D - -o /tmp/a.pdf "http://localhost:3300/shape.pdf?sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter" | grep -i content-type; head -c5 /tmp/a.pdf; echo " $(wc -c < /tmp/a.pdf) bytes"
# multi-page (big shape -> tiles, exercises registration marks)
curl -s -o /tmp/b.pdf "http://localhost:3300/shape.pdf?sides=4&height=30&bottomWidth=30&topWidth=30&clayThickness=0.5&seamMode=sides&units=in&pageSize=letter"; head -c5 /tmp/b.pdf; echo " $(wc -c < /tmp/b.pdf) bytes"
kill $(cat /tmp/sf.pid)
```
Expected: both `Content-Type: application/pdf`, begin with `%PDF-`, non-trivial sizes; the multi-page one larger. Report values.

- [ ] **Step 6: Commit**

```bash
git add src/routes/shape.pdf/+server.ts
git commit -m "feat: PDF print-scale ruler + page registration marks"
```

---

## Task 6: PDF assembly-instructions diagram

**Files:**
- Modify: `src/routes/shape.pdf/+server.ts`

- [ ] **Step 1: Extend `drawAssembleInstructions` to receive the shape + templateSettings and draw a diagram**

Replace the entire `drawAssembleInstructions` function with:

```ts
function drawAssembleInstructions(doc, startY, stepHeight, stepNumber, seamMode, shape, templateSettings) {
  doc.moveTo(doc.page.margins.left, convertUnits(startY, "in", "pt"))
    .lineTo(doc.page.width - doc.page.margins.right, convertUnits(startY, "in", "pt"))
    .stroke();

  doc.fontSize(fontSize).text(
    `${stepNumber}. ${
      seamMode === "base"
        ? "Put the wall together and attach it to the base"
        : "Fold the walls upwards"
    }`,
    doc.page.margins.left,
    convertUnits(startY + 0.1, "in", "pt")
  );

  // Left: the flat template (small), reusing the existing template renderer.
  const tapedX = doc.page.margins.left + 0.5;
  const tapedY = convertUnits(startY + 0.3, "in", "pt");
  const tapedHeight = convertUnits(stepHeight - 0.3, "in", "pt") - 2;
  const tapedWidth =
    (tapedHeight / doc.page.height) *
    doc.page.width *
    (templateSettings.widthPages / templateSettings.heightPages);
  const tapedMargin = (tapedHeight / doc.page.height) * doc.page.margins.top;
  drawTemplate(
    doc,
    { ...templateSettings, widthPages: 1, heightPages: 1 },
    {
      safeX: tapedX + tapedMargin,
      safeY: tapedY + tapedMargin,
      safeWidth: tapedWidth - 2 * tapedMargin,
      safeHeight: tapedHeight - 2 * tapedMargin,
      pageX: 0,
      pageY: 0,
      extraScale: tapedHeight / templateSettings.heightPages / doc.page.height,
    },
    { drawGuide: false, labelGuide: false }
  );

  // Arrow.
  const arrowStartX = tapedX + tapedWidth + convertUnits(0.5, "in", "pt");
  const arrowStartY = convertUnits(startY + 0.05 + stepHeight / 2, "in", "pt");
  const arrowEndX = drawArrow(doc, arrowStartX, arrowStartY);

  // Right: front elevation of the assembled vessel (trapezoid), scaled to fit.
  const vesselHpt = convertUnits(shape.height, shape.units, "pt");
  const elevScale = vesselHpt > 0 ? (tapedHeight * 0.8) / vesselHpt : 1;
  const bw = convertUnits(shape.bottomWidth, shape.units, "pt") * elevScale;
  const tw = convertUnits(shape.topWidth, shape.units, "pt") * elevScale;
  const vh = vesselHpt * elevScale;
  const cx = arrowEndX + convertUnits(0.5, "in", "pt") + Math.max(bw, tw) / 2;
  const baseLineY = tapedY + tapedHeight * 0.9;
  const topLineY = baseLineY - vh;
  doc.moveTo(cx - bw / 2, baseLineY)
    .lineTo(cx + bw / 2, baseLineY)
    .lineTo(cx + tw / 2, topLineY)
    .lineTo(cx - tw / 2, topLineY)
    .lineTo(cx - bw / 2, baseLineY)
    .stroke();
  doc.fontSize(fontSize * 0.7).text("(assembled)", cx - Math.max(bw, tw) / 2, baseLineY + 3);
}
```

- [ ] **Step 2: Update the call site to pass `shape` and `templateSettings`**

In `drawInstructions`, change the call:
```ts
    drawAssembleInstructions(doc, startY, stepHeight, stepNumber, seamMode);
```
to:
```ts
    drawAssembleInstructions(doc, startY, stepHeight, stepNumber, seamMode, shape, templateSettings);
```

- [ ] **Step 3: Verify the PDF renders for both seam modes**

```bash
npm run build && (PORT=3300 node build & echo $! > /tmp/sf.pid) && sleep 2
curl -s -o /tmp/s.pdf "http://localhost:3300/shape.pdf?sides=4&height=5&bottomWidth=5&topWidth=7&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter"; head -c5 /tmp/s.pdf; echo " sides $(wc -c < /tmp/s.pdf)"
curl -s -o /tmp/bz.pdf "http://localhost:3300/shape.pdf?sides=6&height=5&bottomWidth=5&topWidth=8&clayThickness=0.25&seamMode=base&units=cm&pageSize=letter"; head -c5 /tmp/bz.pdf; echo " base $(wc -c < /tmp/bz.pdf)"
curl -s -o /tmp/c.pdf "http://localhost:3300/shape.pdf?sides=%E2%88%9E&height=8&bottomWidth=4&topWidth=7&clayThickness=0.25&seamMode=base&units=cm&pageSize=auto"; head -c5 /tmp/c.pdf; echo " conic $(wc -c < /tmp/c.pdf)"
kill $(cat /tmp/sf.pid)
```
Expected: all three begin with `%PDF-` and are non-trivial sizes (no runtime error from the new diagram drawing). Report values.

- [ ] **Step 4: Commit**

```bash
git add src/routes/shape.pdf/+server.ts
git commit -m "feat: PDF assembly-instructions diagram (flat -> assembled, both seam modes)"
```

---

## Task 7: Extend the E2E suite

**Files:**
- Modify: `e2e/edit.test.ts`

- [ ] **Step 1: Add the tests**

Append to `e2e/edit.test.ts` (keep existing; reuse the existing import):

```ts
test("offers both hump and slump mold download links", async ({ page }) => {
  await page.goto("/edit");
  await expect(page.getByRole("link", { name: "Download Hump Mold" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download Slump Mold" })).toBeVisible();
});

test("mold endpoints return binary STL for both types", async ({ request }) => {
  const q = "sides=6&height=5&bottomWidth=5&topWidth=8&clayThickness=0.25&seamMode=base&units=in&pageSize=letter";
  const hump = await request.get(`/slump-mold.stl?${q}&moldType=hump`);
  expect(hump.headers()["content-type"]).toBe("model/x.stl-binary");
  expect((await hump.body()).length).toBeGreaterThan(84);
  const slump = await request.get(`/slump-mold.stl?${q}&moldType=slump`);
  expect(slump.headers()["content-type"]).toBe("model/x.stl-binary");
  expect((await slump.body()).length).toBeGreaterThan(84);
  const bad = await request.get(`/slump-mold.stl?${q}&moldType=banana`);
  expect(bad.status()).toBe(400);
});

test("PDF still renders after fabrication-fidelity additions", async ({ request }) => {
  const q = "sides=4&height=5&bottomWidth=5&topWidth=7&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter";
  const pdf = await request.get(`/shape.pdf?${q}`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).length).toBeGreaterThan(1000);
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e`
Expected: all pass (the prior 8 + these 3 = 11). It auto-builds + runs `node build`.

- [ ] **Step 3: Commit**

```bash
git add e2e/edit.test.ts
git commit -m "test: e2e for hump/slump mold links + endpoints + PDF regression"
```

---

## Final verification (after all tasks)

- [ ] `npm run check` → 0 errors.
- [ ] `npm run test:unit` → all green (incl. isWatertight, mold, vessel-watertight).
- [ ] `npm run test:e2e` → 11/11.
- [ ] `npm run build` → succeeds.

---

## Self-Review Notes

- **Spec coverage:** Part A (scale guarantee) → Task 5. Part B (registration) → Task 5. Part C (assembly diagram) → Task 6. Part D (mold geometry) → Task 2. Part E (manifold audit) → Tasks 1 (helper) + 4 (vessel) + 2 (molds tested watertight). Part F (endpoint + UI) → Task 3. Testing → Tasks 1/2/4 (unit) + 7 (e2e).
- **Mold sizing:** hump uses interior circumradii widest-end-down; slump uses exterior (`+clayThickness`) circumradii mouth-up — matching the spec's releasability orientation.
- **Bounded risk:** Task 4 Step 3 caps the vessel-winding fix and escalates rather than rabbit-holing; molds (the deliverable) are Tasks 2–3 and don't depend on it.
- **No persisted-state change:** `moldType` rides on the link only (Task 3), so the editor's design-state machinery and golden fixtures are untouched (except a possible deliberate normal-sign golden update in Task 4 Step 3, which is gated on the vessel actually being non-watertight).
- **Names consistent:** `buildHumpMold`/`buildSlumpMold`/`MoldParams`, `isWatertight`, `faceNormal` (newly exported), `drawScaleCheck`/`drawRegistrationMarks` used consistently across defining/consuming tasks.
