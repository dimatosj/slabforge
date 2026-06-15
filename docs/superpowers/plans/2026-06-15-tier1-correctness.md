# Tier 1 Correctness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four silent-correctness defects in slabforge: STL exports at the wrong physical scale, no input validation, inconsistent interior/exterior dimensions in base-seam mode, and a non-exponent-aware PDF-bounds parser.

**Architecture:** Two new pure, unit-tested `$lib` modules (`stl.ts` for binary-STL serialization, `shapeParams.ts` for param parsing/validation) that the three export endpoints consume; targeted edits to `shape.ts` (a `"mm"` unit, interior base outlines, an extracted exponent-aware path-extent helper); a clamp in the number-input component; and regeneration of the geometry golden fixtures for the base-seam/conic cases whose output intentionally changes.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript, Vitest, pdfkit. Work from `/Users/jsd/projects/slabforge` on branch `sveltekit-migration`.

---

## File Structure

- **Modify** `src/lib/shape.ts` — add `"mm"` to `Units`/`convertUnits`; make base-seam (`Prism.calcWallsBaseSeam`) and conic (`Conic.calcWalls`, `Conic.calcPDFBounds`) base outlines use the interior dimension; extract `svgPathExtents` with an exponent-aware regex and use it in `Prism.calcPDFBounds`.
- **Create** `src/lib/stl.ts` — `meshToBinarySTL(mesh, scale)`: pure binary-STL serializer (z-up swap; scales vertices, not normals).
- **Create** `src/lib/stl.test.ts`, `src/lib/shapeParams.test.ts` — unit tests for the new modules.
- **Create** `src/lib/shapeParams.ts` — `parseShapeParams(searchParams)` + `ShapeParamError`.
- **Modify** `src/routes/shape.stl/+server.ts`, `src/routes/slump-mold.stl/+server.ts`, `src/routes/shape.pdf/+server.ts` — validate via `parseShapeParams` (400 on error); STL routes serialize via `meshToBinarySTL` scaled to mm.
- **Modify** `src/lib/components/SpinnerSliderControl.svelte` — clamp the number input to `[min,max]` on change.
- **Modify** `scripts/capture-golden.ts` — repoint at the TS module; regenerate `test-fixtures/golden-geometry.json`.
- **Modify** `src/lib/shape.test.ts` — add the interior-radius assertion and the `svgPathExtents` exponent test.

---

## Task 1: Add a millimeter unit to `convertUnits`

**Files:**
- Modify: `src/lib/shape.ts` (the `Units` type at line 3 and `convertUnits` at lines 36–63)
- Test: `src/lib/shape.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/shape.test.ts` (import `convertUnits` alongside the existing `makeShape` import — change the top import to `import makeShape, { convertUnits } from "./shape";`), in a new `describe`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `convertUnits` throws `unknown unit: mm`.

- [ ] **Step 3: Implement**

In `src/lib/shape.ts`, change the `Units` type (line 3) to include `"mm"`:

```ts
export type Units = "pt" | "in" | "cm" | "px" | "mm";
```

In `convertUnits`, add an `mm` branch to BOTH the from-block (after the `cm` branch, before `px`) and the to-block. `1 cm = 28.35 pt`, so `1 mm = 2.835 pt`:

From-block (insert after the `cm` `else if`):
```ts
    } else if (from === "mm") {
        quantityPt = quantity * 2.835;
```
To-block (insert after the `cm` `else if`):
```ts
    } else if (to === "mm") {
        return quantityPt / 2.835;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (the new `convertUnits mm` tests green; the 7 golden cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shape.ts src/lib/shape.test.ts
git commit -m "feat: add millimeter unit to convertUnits"
```

---

## Task 2: Pure binary-STL serializer (`$lib/stl.ts`)

**Files:**
- Create: `src/lib/stl.ts`
- Test: `src/lib/stl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/stl.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './stl'`.

- [ ] **Step 3: Implement**

Create `src/lib/stl.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (all 3 `meshToBinarySTL` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stl.ts src/lib/stl.test.ts
git commit -m "feat: extract pure binary-STL serializer with vertex scaling"
```

---

## Task 3: Param parser/validator (`$lib/shapeParams.ts`)

**Files:**
- Create: `src/lib/shapeParams.ts`
- Test: `src/lib/shapeParams.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/shapeParams.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './shapeParams'`.

- [ ] **Step 3: Implement**

Create `src/lib/shapeParams.ts`:

```ts
import type { Units } from "./shape";

export class ShapeParamError extends Error {}

export interface ShapeParams {
  sides: number | "∞";
  height: number;
  bottomWidth: number;
  topWidth: number;
  clayThickness: number;
  seamMode: "sides" | "base";
  units: Units;
  pageSize: string;
}

function positive(sp: URLSearchParams, key: string): number {
  const v = parseFloat(sp.get(key) ?? "");
  if (!Number.isFinite(v) || v <= 0) {
    throw new ShapeParamError(`Invalid or missing "${key}": must be a positive number`);
  }
  return v;
}

export function parseShapeParams(sp: URLSearchParams): ShapeParams {
  const sidesRaw = sp.get("sides");
  let sides: number | "∞";
  if (sidesRaw === "∞") {
    sides = "∞";
  } else {
    const n = Number(sidesRaw);
    if (!Number.isInteger(n) || n < 3 || n > 20) {
      throw new ShapeParamError(`Invalid "sides": must be "∞" or an integer between 3 and 20`);
    }
    sides = n;
  }

  const height = positive(sp, "height");
  const bottomWidth = positive(sp, "bottomWidth");
  const topWidth = positive(sp, "topWidth");
  const clayThickness = positive(sp, "clayThickness");

  const seamMode = sp.get("seamMode") ?? "sides";
  if (seamMode !== "sides" && seamMode !== "base") {
    throw new ShapeParamError(`Invalid "seamMode": must be "sides" or "base"`);
  }

  const units = sp.get("units") ?? "in";
  if (units !== "in" && units !== "cm") {
    throw new ShapeParamError(`Invalid "units": must be "in" or "cm"`);
  }

  const pageSize = sp.get("pageSize") ?? "letter";
  if (pageSize !== "letter" && pageSize !== "auto") {
    throw new ShapeParamError(`Invalid "pageSize": must be "letter" or "auto"`);
  }

  return { sides, height, bottomWidth, topWidth, clayThickness, seamMode, units, pageSize };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (all `parseShapeParams` cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shapeParams.ts src/lib/shapeParams.test.ts
git commit -m "feat: add validated shape-param parser"
```

---

## Task 4: Wire the three export endpoints to validate + scale STL to mm

Depends on Tasks 1–3. Rewrite each endpoint to validate via `parseShapeParams` (returning 400 on `ShapeParamError`) and, for the two STL routes, serialize via `meshToBinarySTL` scaled to mm.

**Files:**
- Modify: `src/routes/shape.stl/+server.ts`
- Modify: `src/routes/slump-mold.stl/+server.ts`
- Modify: `src/routes/shape.pdf/+server.ts`

- [ ] **Step 1: Replace `src/routes/shape.stl/+server.ts` entirely**

```ts
import type { RequestHandler } from "./$types";
import makeShape, { convertUnits } from "$lib/shape";
import { parseShapeParams, ShapeParamError } from "$lib/shapeParams";
import { meshToBinarySTL } from "$lib/stl";

export const GET: RequestHandler = ({ url }) => {
  let p;
  try {
    p = parseShapeParams(url.searchParams);
  } catch (e) {
    if (e instanceof ShapeParamError) return new Response(e.message, { status: 400 });
    throw e;
  }

  const shape = makeShape(p.sides, p.height, p.bottomWidth, p.topWidth, p.clayThickness, p.seamMode, p.units);
  const body = meshToBinarySTL(shape.calc3DGeometry(), convertUnits(1, p.units, "mm"));

  const type = p.sides === "∞" ? "circle" : "prism-" + p.sides;
  const filename = `slabforge-${type}-${p.height}-${p.bottomWidth}-${p.topWidth}-${p.clayThickness}-${p.units}.stl`;
  return new Response(body, {
    headers: {
      "Content-Type": "model/x.stl-binary",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
```

- [ ] **Step 2: Replace `src/routes/slump-mold.stl/+server.ts` entirely**

```ts
import type { RequestHandler } from "./$types";
import makeShape, { convertUnits } from "$lib/shape";
import { parseShapeParams, ShapeParamError } from "$lib/shapeParams";
import { meshToBinarySTL } from "$lib/stl";

export const GET: RequestHandler = ({ url }) => {
  let p;
  try {
    p = parseShapeParams(url.searchParams);
  } catch (e) {
    if (e instanceof ShapeParamError) return new Response(e.message, { status: 400 });
    throw e;
  }

  const ct = p.clayThickness;
  const shape = makeShape(
    p.sides,
    p.height + ct,
    p.bottomWidth + ct,
    p.topWidth + ct,
    convertUnits(0.5, "cm", p.units),
    p.seamMode,
    p.units
  );
  const body = meshToBinarySTL(shape.calc3DGeometry(), convertUnits(1, p.units, "mm"));

  const type = p.sides === "∞" ? "circle" : "prism-" + p.sides;
  const filename = `slabforge-${type}-${p.height}-${p.bottomWidth}-${p.topWidth}-${p.clayThickness}-${p.units}-slump-mold.stl`;
  return new Response(body, {
    headers: {
      "Content-Type": "model/x.stl-binary",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
```

- [ ] **Step 3: Update the top of `src/routes/shape.pdf/+server.ts`**

This file begins with `// @ts-nocheck` and an `import PDFDocument ...` block, followed by the verbatim drawing functions, then the `GET` handler. Leave the drawing functions untouched. Add the two new imports near the top (after the existing `import makeShape, { convertUnits } from "$lib/shape";`):

```ts
import { parseShapeParams, ShapeParamError } from "$lib/shapeParams";
```

Then replace the handler's parameter-parsing preamble — the lines from `export const GET: RequestHandler = async ({ url }) => {` through the `const shape = makeShape(...)` call — with:

```ts
export const GET: RequestHandler = async ({ url }) => {
  let p;
  try {
    p = parseShapeParams(url.searchParams);
  } catch (e) {
    if (e instanceof ShapeParamError) return new Response(e.message, { status: 400 });
    throw e;
  }
  const { sides, height, bottomWidth, topWidth, clayThickness, seamMode, units, pageSize } = p;
  const noDownload = url.searchParams.get("noDownload");

  const shape = makeShape(sides, height, bottomWidth, topWidth, clayThickness, seamMode, units);
```

Everything after that (`const scale = calcScale(shape.units);` onward, including the `pageSize === "auto"` handling, the page loop, and the `Content-Disposition` block guarded by `if (!noDownload)`) stays exactly as-is — the locals it references (`sides`, `height`, … `pageSize`, `noDownload`) are all still in scope.

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: 0 errors (the PDF file remains `@ts-nocheck`; the two STL files type-check clean).

- [ ] **Step 5: Verify valid downloads + 400 on bad input (production build)**

```bash
npm run build && (PORT=3300 node build & echo $! > /tmp/sf.pid) && sleep 2
# valid STL: 5in vessel -> mm-scaled. sides=4 -> 32 faces -> 84 + 50*32 = 1684 bytes
curl -s -D - -o /tmp/s.stl "http://localhost:3300/shape.stl?sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in" | grep -i "content-type"; wc -c < /tmp/s.stl
# the first vertex coordinate should now be ~mm scale (127 for a 5in dimension), not ~5
node -e "const b=require('fs').readFileSync('/tmp/s.stl'); console.log('max |coord| ~', Math.max(...Array.from({length:24},(_, i)=>Math.abs(b.readFloatLE(96+i*4)))).toFixed(1))"
# invalid -> 400
curl -s -o /dev/null -w "height=0 -> %{http_code}\n" "http://localhost:3300/shape.stl?sides=4&height=0&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in"
curl -s -o /dev/null -w "sides=2 -> %{http_code}\n" "http://localhost:3300/shape.pdf?sides=2&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter"
curl -s -o /dev/null -w "valid pdf -> %{http_code}\n" "http://localhost:3300/shape.pdf?sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter"
kill $(cat /tmp/sf.pid)
```
Expected: STL Content-Type `model/x.stl-binary`, ~1684 bytes, and coordinate magnitudes in the ~100+ range (mm), not ~5; `height=0 -> 400`; `sides=2 -> 400`; `valid pdf -> 200`. (If port 3300 is busy, pick another and adjust.)

- [ ] **Step 6: Commit**

```bash
git add src/routes/shape.stl/+server.ts src/routes/slump-mold.stl/+server.ts src/routes/shape.pdf/+server.ts
git commit -m "feat: validate export params (400) and export STL in millimeters"
```

---

## Task 5: Clamp the number input in `SpinnerSliderControl`

**Files:**
- Modify: `src/lib/components/SpinnerSliderControl.svelte`

- [ ] **Step 1: Replace the component**

The number `<input>` currently has no clamping, so typed out-of-range/empty values flow through. Add an `onchange` handler that clamps to `[min,max]` (empty/NaN → `min`). Replace the whole file with:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    value: unknown;
    min?: string | number;
    max?: string | number;
    step?: string | number;
    onmouseenter?: (event: MouseEvent) => void;
    onmouseleave?: (event: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    value = $bindable(),
    min = undefined,
    max = undefined,
    step = undefined,
    onmouseenter = undefined,
    onmouseleave = undefined,
    children,
  }: Props = $props();

  // Clamp typed entries on commit: HTML min/max do not constrain typed values,
  // so without this a user can type 0, a negative, a huge number, or clear the
  // field and push NaN/out-of-range values into the shape.
  function clampOnChange(event: Event) {
    const lo = min === undefined ? -Infinity : Number(min);
    const hi = max === undefined ? Infinity : Number(max);
    let n = parseFloat((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(n)) {
      n = Number.isFinite(lo) ? lo : 0;
    } else {
      n = Math.min(hi, Math.max(lo, n));
    }
    value = n;
  }
</script>

<fieldset {onmouseenter} {onmouseleave}>
  <label>
    {@render children?.()}
    <input type="range" {min} {max} {step} bind:value />
    <input type="number" {min} {max} {step} bind:value onchange={clampOnChange} />
  </label>
</fieldset>
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Verify the clamp behaves (production build + Playwright snippet)**

```bash
npm run build && (PORT=3300 node build & echo $! > /tmp/sf.pid) && sleep 2
cat > /Users/jsd/projects/slabforge/_clamp.mjs <<'EOF'
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:3300/edit', { waitUntil: 'networkidle' });
// Bottom Width number input: min=1, max=50. Type an out-of-range value and blur.
const num = p.locator('input[type=number]').nth(2); // sides, height, bottomWidth (0-indexed: 0=sides,1=height,2=bottomWidth)
await num.fill('999'); await num.blur(); await p.waitForTimeout(200);
console.log('after 999 ->', await num.inputValue());
await num.fill('0'); await num.blur(); await p.waitForTimeout(200);
console.log('after 0 ->', await num.inputValue());
await num.fill(''); await num.blur(); await p.waitForTimeout(200);
console.log('after empty ->', await num.inputValue());
await b.close();
EOF
node _clamp.mjs; rm -f _clamp.mjs
kill $(cat /tmp/sf.pid)
```
Expected: `after 999 -> 50`, `after 0 -> 1`, `after empty -> 1` (clamped to the Bottom Width min=1/max=50). If the input index differs, identify the Bottom Width number field by reading the page and adjust `.nth(...)`; report the actual mapping.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/SpinnerSliderControl.svelte
git commit -m "fix: clamp number input to [min,max] on change"
```

---

## Task 6: Base-seam interior consistency + regenerate golden

`bottomWidth`/`topWidth` are the **interior** dimension. The base-seam base outline (`Prism.calcWallsBaseSeam`) and the conic base (`Conic.calcWalls`, `Conic.calcPDFBounds`) currently draw at the *exterior* radius (`bottomRadius + clayThickness`). Make them use the interior radius. This intentionally changes base-seam/conic output, so the golden fixtures for those cases are regenerated.

**Files:**
- Modify: `src/lib/shape.ts` (`Prism.calcWallsBaseSeam`, `Conic.calcWalls`, `Conic.calcPDFBounds`)
- Modify: `scripts/capture-golden.ts`
- Modify: `test-fixtures/golden-geometry.json` (regenerated)
- Test: `src/lib/shape.test.ts`

- [ ] **Step 1: Write the failing assertion test**

Add to `src/lib/shape.test.ts` in a new `describe` (it imports `makeShape` already):

```ts
describe("base-seam uses interior dimension", () => {
  it("draws the prism base outline at the interior radius (not +clayThickness)", () => {
    const sides = 4, bottomWidth = 5, clayThickness = 0.25;
    const shape = makeShape(sides, 5, bottomWidth, 5, clayThickness, "base", "in");
    const bottomApothem = bottomWidth / 2;
    const bottomRadius = bottomApothem / Math.cos(Math.PI / sides);
    // base outline is calcWalls()[0]: "M x0,y0 x1,y1 ... z"; first vertex (k=0) x = cos(0)*radius
    const base = shape.calcWalls()[0];
    const firstX = parseFloat(base.replace(/^M\s+/, "").split(",")[0]);
    expect(firstX).toBeCloseTo(bottomRadius, 6); // interior
    expect(firstX).not.toBeCloseTo(bottomRadius + clayThickness, 6); // not exterior
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `firstX` is currently `bottomRadius + clayThickness`.

- [ ] **Step 3: Replace `Prism.calcWallsBaseSeam`**

Replace the entire `calcWallsBaseSeam()` method (currently lines ~286–330) with:

```ts
    calcWallsBaseSeam() {
        const { sides, clayThickness } = this;
        const { bottomRadius, bottomSideLen, topSideLen } = this.doMath();

        // Base outline = interior floor footprint (width = interior dimension).
        let base = "M ";
        for (let k = 0; k < sides; k++) {
            const theta = (2 * Math.PI * k) / sides;
            const x = Math.cos(theta) * bottomRadius;
            const y = Math.sin(theta) * bottomRadius + bottomRadius + 1;
            base += `${x},${y} `;
        }
        base += "z";

        let outerWalls = "";
        let innerWalls = "";
        const { outer, inner } = this.calcWallPointsBaseSeam();
        for (let i = 0; i < outer.length; i++) {
            let j = inner.length - 1 - i;
            outerWalls += `${outer[i].x},${outer[i].y} `;
            innerWalls += `${inner[j].x},${inner[j].y} `;
        }
        let walls = `M ${outerWalls}${innerWalls}z`;

        // calculate the bevel guide
        const minSideLen = Math.min(bottomSideLen, topSideLen);
        const bevelGuideLength = sides * minSideLen;
        const baseDiameter = 2 * bottomRadius;
        const guide =
            `M ${bevelGuideLength / 2 + clayThickness / 2},${
                baseDiameter + 2
            } ` +
            `L ${bevelGuideLength / 2 - clayThickness / 2},${
                baseDiameter + 2 + clayThickness
            } ` +
            `${-bevelGuideLength / 2 - clayThickness / 2},${
                baseDiameter + 2 + clayThickness
            } ` +
            `${-bevelGuideLength / 2 + clayThickness / 2},${
                baseDiameter + 2
            } z`;
        return [base, walls, guide];
    }
```

- [ ] **Step 4: Replace `Conic.calcWalls`**

Replace the entire `calcWalls()` method in the `Conic` class (currently lines ~633–687) with:

```ts
    calcWalls() {
        const { bottomWidth, clayThickness } = this;
        const { bottomRadius, topRadius, wallLength } = this.doMath();
        const result = [];
        // Base outline = interior footprint (radius = interior dimension).
        const baseRadius = bottomRadius;
        const baseDiameter = bottomWidth;
        // Bottom is easy.
        result.push(
            `M 0,0 A ${baseRadius} ${baseRadius} 0 1 0 0,${baseDiameter} ${baseRadius} ${baseRadius} 0 1 0 0,0`
        );
        let bevelGuideLength;
        // Wall and bevel guide when the radii match is easy.
        if (bottomRadius === topRadius) {
            const circumference = 2 * Math.PI * bottomRadius;
            result.push(
                `M -${
                    circumference / 2
                },-1 h ${circumference} v -${wallLength} h -${circumference} z`
            );
            bevelGuideLength = circumference;
        } else {
            // Wall when the radii do not match is a nuisance.
            const {
                minCircumference,
                theta,
                innerRadius,
                outerRadius,
                p,
            } = this.doAnnulusSectorMath();
            const bigArc = theta > Math.PI ? 1 : 0;
            const wallD =
                `M ${p[0].x},${p[0].y} ` +
                `A ${innerRadius} ${innerRadius} 0 ${bigArc} 0 ${p[1].x},${p[1].y} ` +
                `L ${p[2].x},${p[2].y} ` +
                `A ${outerRadius} ${outerRadius} 0 ${bigArc} 1 ${p[3].x},${p[3].y} ` +
                `z`;
            result.push(wallD);
            bevelGuideLength = minCircumference;
        }
        result.push(
            `M ${bevelGuideLength / 2 + clayThickness / 2},${
                baseDiameter + 1
            } ` +
                `L ${bevelGuideLength / 2 - clayThickness / 2},${
                    baseDiameter + 1 + clayThickness
                } ` +
                `${-bevelGuideLength / 2 - clayThickness / 2},${
                    baseDiameter + 1 + clayThickness
                } ` +
                `${-bevelGuideLength / 2 + clayThickness / 2},${
                    baseDiameter + 1
                } z`
        );
        return result;
    }
```

- [ ] **Step 5: Update `Conic.calcPDFBounds`**

In the `Conic` class `calcPDFBounds()` (currently lines ~717–739), change the two lines that derive from the exterior width. Replace:

```ts
        const outerBottomWidth = bottomWidth + 2 * clayThickness;
        const xs = [0];
        const ys = [0, bottomWidth, outerBottomWidth + 1 + clayThickness];
```
with:
```ts
        const baseDiameter = bottomWidth; // interior footprint
        const xs = [0];
        const ys = [0, bottomWidth, baseDiameter + 1 + clayThickness];
```
(Leave the rest of the method unchanged.)

- [ ] **Step 6: Run the assertion test to verify it passes**

Run: `npm run test:unit`
Expected: the new `base-seam uses interior dimension` test PASSES. The 7 golden cases will now FAIL (base-seam/conic output changed) — that is expected; Step 7 regenerates them.

- [ ] **Step 7: Repoint and run the golden regeneration script**

In `scripts/capture-golden.ts`, update the header comment (lines 1–2) and the import (line 5). Change:
```ts
// Run against the EXISTING src/lib/shape.js (three.js 0.124) to record golden
// outputs. Run with: npx tsx scripts/capture-golden.ts
import { writeFileSync } from "node:fs";
// @ts-ignore - legacy JS module, no types
import makeShape from "../src/lib/shape.js";
```
to:
```ts
// Regenerate the geometry golden fixtures from the current TypeScript module.
// Run with: npx tsx scripts/capture-golden.ts
import { writeFileSync } from "node:fs";
import makeShape from "../src/lib/shape.ts";
```
Then run: `npx tsx scripts/capture-golden.ts`
Expected: prints `wrote 7 golden cases`.

- [ ] **Step 8: Verify ONLY the intended cases changed, then re-run tests**

Run: `git diff --stat test-fixtures/golden-geometry.json` and inspect with `git diff test-fixtures/golden-geometry.json`.
Expected: changes appear ONLY in the base-seam cases (`seamMode:"base"`: the `sides:6` and `sides:4` prism entries) and the two `sides:"∞"` conic entries — specifically their `walls` base/bevel-guide coordinates and `pdfBounds`. The three sides-seam cases (`sides:4`/`3`/`5`, `seamMode:"sides"`) MUST be unchanged. If any sides-seam case changed, stop and report — something is wrong.

Run: `npm run test:unit`
Expected: PASS (regenerated golden + the interior assertion both green).

- [ ] **Step 9: Commit**

```bash
git add src/lib/shape.ts scripts/capture-golden.ts test-fixtures/golden-geometry.json src/lib/shape.test.ts
git commit -m "fix: base-seam/conic base outlines use interior dimension; regenerate golden"
```

---

## Task 7: Exponent-aware PDF-bounds parsing (defensive hardening)

Extract `Prism.calcPDFBounds`'s inline coordinate regex into a tested `svgPathExtents` helper whose exponent branch accepts `e[+-]?` (today it accepts `e-` but not `e+`); harden the `bevelGuidePositionMatch` regex in the PDF endpoint and guard its null case. This is belt-and-suspenders (the `e+` path needs magnitudes ≥ 1e21, effectively unreachable through real input), but it's cheap and the null-guard removes a real crash path.

**Files:**
- Modify: `src/lib/shape.ts` (add `svgPathExtents`; use it in `Prism.calcPDFBounds`)
- Modify: `src/routes/shape.pdf/+server.ts` (bevel-guide regex + null-guard)
- Test: `src/lib/shape.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/shape.test.ts` (add `svgPathExtents` to the import from `./shape`):

```ts
describe("svgPathExtents", () => {
  it("parses normal coordinates", () => {
    expect(svgPathExtents(["M 1,2 3,4 z"])).toEqual({ top: 2, bottom: 4, left: 1, right: 3 });
  });
  it("parses exponential coordinates including e+", () => {
    const ext = svgPathExtents(["M 1e+21,-2e+21 3,4 z"]);
    expect(ext.right).toBe(1e21);
    expect(ext.top).toBe(-2e21);
    expect(ext.left).toBe(3);
    expect(ext.bottom).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `svgPathExtents` is not exported.

- [ ] **Step 3: Implement `svgPathExtents` and use it**

In `src/lib/shape.ts`, add this exported helper near the other top-level helpers (e.g. just after `convertUnits`):

```ts
// Extracts the bounding box of one or more SVG path strings by scanning their
// "x,y" coordinate pairs. The exponent branch accepts e+ / e- so large-magnitude
// coordinates are not silently truncated.
const COORD_RE = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)?,(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g;
export function svgPathExtents(paths: string[]): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const path of paths) {
    for (const point of path.matchAll(COORD_RE)) {
      if (point[1] !== undefined) xs.push(parseFloat(point[1]));
      ys.push(parseFloat(point[2]));
    }
  }
  return {
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
  };
}
```

Then replace the body of `Prism.calcPDFBounds()` (currently lines ~407–426) with:

```ts
    calcPDFBounds() {
        return svgPathExtents(this.calcWalls());
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — both `svgPathExtents` tests green, and the 7 golden cases still green (the extraction preserves the math for normal coordinates).

- [ ] **Step 5: Harden the PDF endpoint bevel-guide regex + null-guard**

In `src/routes/shape.pdf/+server.ts`, the handler currently has:
```ts
  let bevelGuidePath = shapeWalls[shapeWalls.length - 1];
  let bevelGuidePositionMatch = /L [\-.\d]+,[\-.\d]+ ([\-.\d]+),([\-.\d]+)/.exec(bevelGuidePath);
  let bevelGuideX = parseFloat(bevelGuidePositionMatch[1]);
  let bevelGuideY = parseFloat(bevelGuidePositionMatch[2]);
```
Replace those four lines with an exponent-aware regex and a null-guard so a non-matching path falls back to the origin instead of throwing:
```ts
  let bevelGuidePath = shapeWalls[shapeWalls.length - 1];
  let bevelGuidePositionMatch =
    /L [\-.\de+]+,[\-.\de+]+ (-?[\d.]+(?:e[+-]?\d+)?),(-?[\d.]+(?:e[+-]?\d+)?)/.exec(bevelGuidePath);
  let bevelGuideX = bevelGuidePositionMatch ? parseFloat(bevelGuidePositionMatch[1]) : 0;
  let bevelGuideY = bevelGuidePositionMatch ? parseFloat(bevelGuidePositionMatch[2]) : 0;
```

- [ ] **Step 6: Type-check, full test, build**

Run: `npm run check && npm run test:unit`
Expected: 0 type errors; all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/shape.ts src/routes/shape.pdf/+server.ts src/lib/shape.test.ts
git commit -m "fix: exponent-aware SVG path-extent parsing; guard PDF bevel-guide match"
```

---

## Final verification (after all tasks)

- [ ] `npm run check` → 0 errors.
- [ ] `npm run test:unit` → all green (golden 7 + convertUnits-mm + stl + shapeParams + interior assertion + svgPathExtents).
- [ ] `npm run test:e2e` → 4/4 (the existing E2E still passes against the rebuilt server).
- [ ] `npm run build` → succeeds.

---

## Self-Review Notes

- **Spec coverage:** Fix 1 (STL mm) → Tasks 1, 2, 4. Fix 2 (validation) → Tasks 3, 4 (endpoints, 400) + Task 5 (UI clamp). Fix 3 (base-seam interior + golden regen) → Task 6. Fix 4 (exponent regex + null-guard) → Task 7. Golden strategy → Task 6 Steps 7–8.
- **Behavior changes & golden:** only Task 6 changes `shape.ts` geometry output; Tasks 1/4 (mm) scale only at export; Task 7 preserves normal-coordinate parsing. So only base-seam/conic golden entries change — verified by the Step 8 diff check.
- **Type/name consistency:** `meshToBinarySTL(mesh, scale)`, `parseShapeParams`/`ShapeParamError`/`ShapeParams`, `svgPathExtents`, and `convertUnits(1, units, "mm")` are used consistently across the tasks that define and consume them.
- **Caveat carried from spec:** the base-seam interior reading (Task 6) is a deliberate convention choice; it's localized to the base-outline lines and reversible if the maker community prefers the exterior footprint.
