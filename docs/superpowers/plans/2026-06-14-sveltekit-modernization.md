# slabforge SvelteKit Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate slabforge from Sapper/Svelte 3/Rollup/Node 14 to SvelteKit/Svelte 5 (runes)/Vite/TypeScript on Node 20, preserving all user-facing behavior and geometry output.

**Architecture:** Capture golden geometry references from the existing code first, then establish a clean SvelteKit + TS baseline, port the geometry math (decoupling it from three.js so it returns plain mesh data), then port components/routes/endpoints, and finally add E2E + a Docker build. three.js becomes a client-only (preview-only) dependency; the STL/PDF server endpoints consume plain mesh/SVG data.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Vite 5, TypeScript 5, `@sveltejs/adapter-node`, Vitest 2 (unit), Playwright (E2E), three.js (current, client-only), pdfkit, lodash, uuid.

**Spec:** `docs/superpowers/specs/2026-06-14-sveltekit-modernization-design.md`

**Working branch:** Do all work on a branch, e.g. `git checkout -b sveltekit-migration` before Task 1.

---

## File Structure

**Removed (Sapper era):**
- `rollup.config.js`, `Procfile`, `cypress.json`, `cypress/`
- `src/client.js`, `src/server.js`, `src/service-worker.js`, `src/template.html`

**Created (config baseline):**
- `package.json` (rewritten), `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `.npmrc`
- `src/app.html`, `src/app.d.ts`
- `playwright.config.ts`

**Ported source:**
- `src/lib/shape.js` → `src/lib/shape.ts` (typed, plain-mesh return, no three.js)
- `src/components/*.svelte` → `src/lib/components/*.svelte` (Svelte 5 runes)
- `src/routes/index.svelte` → `src/routes/+page.svelte`
- `src/routes/edit.svelte` → `src/routes/edit/+page.svelte`
- `src/routes/_layout.svelte` → `src/routes/+layout.svelte`
- `src/routes/_error.svelte` → `src/routes/+error.svelte`
- `src/routes/shape.{pdf,stl}.js`, `slump-mold.stl.js` → `src/routes/<name>/+server.ts`

**Tests / fixtures:**
- `scripts/capture-golden.ts` (run once against old code)
- `test-fixtures/golden-geometry.json` (committed)
- `src/lib/shape.test.ts` (Vitest golden tests)
- `e2e/edit.test.ts` (Playwright)

**Deploy:**
- `Dockerfile`

---

## Task 1: Capture golden geometry references from the existing code

This MUST run before any dependency changes, while the old three.js (0.124, which still has `Geometry`/`Face3`) is installable. The fixture is committed and survives the rest of the migration.

**Files:**
- Create: `scripts/capture-golden.ts`
- Create: `test-fixtures/golden-geometry.json` (generated)

- [ ] **Step 1: Install the existing dependencies without running the Sapper postinstall build**

Run: `npm install --ignore-scripts`
Expected: dependencies install (including `three@0.124`, `lodash`); the `sapper build` postinstall is skipped, so this succeeds on Node 20.

- [ ] **Step 2: Write the capture script**

Create `scripts/capture-golden.ts`:

```ts
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
```

- [ ] **Step 3: Run the capture script**

Run: `mkdir -p test-fixtures && npx tsx scripts/capture-golden.ts`
Expected: prints `wrote 7 golden cases`; `test-fixtures/golden-geometry.json` exists and is valid JSON with 7 entries. (If `npx` prompts to install `tsx`, accept.)

- [ ] **Step 4: Sanity-check the fixture**

Run: `node -e "const g=require('./test-fixtures/golden-geometry.json'); console.log(g.length, g[0].walls.length, g[0].mesh.faces.length, g[5].params.sides)"`
Expected: prints `7`, a non-zero wall count, a non-zero face count, and `∞`.

- [ ] **Step 5: Commit**

```bash
git add scripts/capture-golden.ts test-fixtures/golden-geometry.json
git commit -m "test: capture golden geometry references from legacy code"
```

---

## Task 2: Establish the SvelteKit + Vite + TypeScript baseline

Replace the Sapper toolchain with SvelteKit config files authored directly (deterministic, no interactive scaffolder).

**Files:**
- Modify: `package.json` (full rewrite)
- Create: `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `.npmrc`, `src/app.html`, `src/app.d.ts`
- Delete: `rollup.config.js`, `Procfile`, `cypress.json`, `cypress/`, `src/client.js`, `src/server.js`, `src/service-worker.js`, `src/template.html`

- [ ] **Step 1: Rewrite `package.json`**

```json
{
  "name": "slabforge",
  "description": "Design templates for slab ceramics construction",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "prepare": "svelte-kit sync",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "format": "prettier --write ."
  },
  "dependencies": {
    "lodash": "^4.17.21",
    "pdfkit": "^0.15.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@sveltejs/adapter-node": "^5.2.0",
    "@sveltejs/kit": "^2.7.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@types/lodash": "^4.17.0",
    "@types/pdfkit": "^0.13.4",
    "@types/three": "^0.169.0",
    "@types/uuid": "^9.0.0",
    "prettier": "^3.3.0",
    "prettier-plugin-svelte": "^3.2.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "three": "^0.169.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `.npmrc`**

```
engine-strict=false
```

- [ ] **Step 3: Create `svelte.config.js`**

```js
import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
});
```

- [ ] **Step 5: Create `tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 6: Create `src/app.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <meta name="theme-color" content="#333333" />
    <link rel="stylesheet" href="/global.css" />
    <link rel="manifest" href="/manifest.json" crossorigin="use-credentials" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    %sveltekit.head%
  </head>
  <body>
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 7: Create `src/app.d.ts`**

```ts
declare global {
  namespace App {}
}

export {};
```

- [ ] **Step 8: Delete the Sapper files**

```bash
git rm rollup.config.js Procfile cypress.json src/client.js src/server.js src/service-worker.js src/template.html
git rm -r cypress
```

- [ ] **Step 9: Install dependencies and sync SvelteKit**

Run: `rm -rf node_modules package-lock.json && npm install && npx svelte-kit sync`
Expected: install succeeds; `.svelte-kit/tsconfig.json` is generated (so the `tsconfig.json` extends target exists).

- [ ] **Step 10: Verify the baseline type-checks**

Run: `npm run check`
Expected: completes (there will be "no routes" but no config errors). It is acceptable for this to report missing route files; it must NOT report config/parse errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: replace Sapper toolchain with SvelteKit + Vite + TS baseline"
```

---

## Task 3: Port the geometry math to TypeScript with plain-mesh output (golden tests)

The heart of the migration. `shape.ts` is `shape.js` with types added, three.js removed, and the three 3D methods returning plain data.

**Files:**
- Create: `src/lib/shape.ts`
- Create: `src/lib/shape.test.ts`
- Delete: `src/lib/shape.js`

- [ ] **Step 1: Write the failing golden test**

Create `src/lib/shape.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import golden from "../../test-fixtures/golden-geometry.json";
import makeShape from "./shape";

type Vec3 = { x: number; y: number; z: number };

function expectVecClose(actual: Vec3, expected: Vec3, label: string) {
  expect(actual.x, `${label}.x`).toBeCloseTo(expected.x, 6);
  expect(actual.y, `${label}.y`).toBeCloseTo(expected.y, 6);
  expect(actual.z, `${label}.z`).toBeCloseTo(expected.z, 6);
}

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './shape'` (shape.ts not created yet).

- [ ] **Step 3: Create `src/lib/shape.ts` from `shape.js`**

Copy the entire current `src/lib/shape.js` into `src/lib/shape.ts`, then apply these changes:

(a) **Delete** the top line `import { Color, Face3, Geometry, Vector3 } from "three";` and the `const RED = new Color(0xff6633);` line.

(b) **Add** at the top, after `import round from "lodash/round";`, the shared types and helpers:

```ts
export type Units = "pt" | "in" | "cm" | "px";
export type Vec3 = { x: number; y: number; z: number };
export type Color = { r: number; g: number; b: number };
export type Face = { a: number; b: number; c: number; normal: Vec3; color: Color };
export type Mesh = { vertices: Vec3[]; faces: Face[] };
export type LineGeometry = { vertices: Vec3[] };

const WHITE: Color = { r: 1, g: 1, b: 1 };
const RED: Color = { r: 1, g: 0.4, b: 0.2 }; // three.js Color(0xff6633)

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
// Replicates three.js r124 Geometry.computeFaceNormals():
// normal = normalize((vC - vB) x (vA - vB))
function faceNormal(va: Vec3, vb: Vec3, vc: Vec3): Vec3 {
  return normalize(cross(sub(vc, vb), sub(va, vb)));
}
function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
```

(c) Add type annotations to `convertUnits`: `export function convertUnits(quantity: number, from: Units, to: Units): number`.

(d) Keep the `Prism` and `Conic` class bodies, `doMath`, `calcWalls*`, `calcCreaseMarkers`, `calcBevelMarkers*`, `calcWallPointsBaseSeam`, `calcPDFBounds`, `doAnnulusSectorMath`, and `makeShape` **verbatim** (the trig/string logic is unchanged). Add field types in the `Prism` constructor (`sides: number, height: number, bottomWidth: number, topWidth: number, clayThickness: number, seamMode: string, units: Units`) and `Conic` constructor (`height: number, bottomWidth: number, topWidth: number, clayThickness: number, units: Units`). `makeShape`'s signature: `export default function makeShape(sides: number | "∞", height: any, bottomWidth: any, topWidth: any, clayThickness: any, seamMode: string, units: Units): Prism | Conic`.

(e) **Replace** `Prism.calc3DVertices()` with this plain-object version (only `makeVertex` and vertex creation change — no `Vector3`):

```ts
calc3DVertices() {
  let { sides, height, clayThickness } = this;
  const { bottomRadius, topRadius, bevelFactor } = this.doMath();
  const vertices: Vec3[] = [];

  function makeVertex(x: number, y: number, z: number): number {
    const result = vertices.length;
    vertices.push({ x, y, z });
    return result;
  }
  const outerBottomCenter = makeVertex(0, 0, 0);
  const innerBottomCenter = makeVertex(0, clayThickness, 0);
  const topCenter = makeVertex(0, height + clayThickness, 0);
  const sideVertices = [];
  const cornerThickness = clayThickness / Math.cos(bevelFactor) / 2;
  for (let k = 0; k < sides; k++) {
    const theta = (2 * Math.PI * k) / sides;
    const outerBottomX = Math.cos(theta) * (bottomRadius + cornerThickness);
    const outerBottomZ = Math.sin(theta) * (bottomRadius + cornerThickness);
    const innerBottomX = Math.cos(theta) * bottomRadius;
    const innerBottomZ = Math.sin(theta) * bottomRadius;
    const outerTopX = Math.cos(theta) * (topRadius + cornerThickness);
    const outerTopZ = Math.sin(theta) * (topRadius + cornerThickness);
    const innerTopX = Math.cos(theta) * topRadius;
    const innerTopZ = Math.sin(theta) * topRadius;
    sideVertices.push({
      outerBottom: makeVertex(outerBottomX, 0, outerBottomZ),
      innerBottom: makeVertex(innerBottomX, clayThickness, innerBottomZ),
      outerTop: makeVertex(outerTopX, height + clayThickness, outerTopZ),
      innerTop: makeVertex(innerTopX, height + clayThickness, innerTopZ),
    });
  }
  return { vertices, outerBottomCenter, innerBottomCenter, topCenter, sideVertices };
}
```

(f) **Replace** `Prism.calc3DGeometry()` with this plain-`Mesh` version. It builds the same faces in the same order, assigns `RED` to the two bottom faces (others `WHITE`), and computes each normal with `faceNormal`:

```ts
calc3DGeometry(): Mesh {
  let { sides } = this;
  let { vertices, outerBottomCenter, innerBottomCenter, sideVertices } = this.calc3DVertices();
  const faces: Face[] = [];
  const pushFace = (a: number, b: number, c: number, color: Color = WHITE) => {
    faces.push({ a, b, c, color, normal: faceNormal(vertices[a], vertices[b], vertices[c]) });
  };
  for (let k = 0; k < sides; k++) {
    const thisSide = sideVertices[k];
    const nextSide = sideVertices[(k + 1) % sides];
    pushFace(outerBottomCenter, thisSide.outerBottom, nextSide.outerBottom, RED);
    pushFace(thisSide.outerBottom, thisSide.outerTop, nextSide.outerBottom);
    pushFace(nextSide.outerBottom, thisSide.outerTop, nextSide.outerTop);
    pushFace(innerBottomCenter, nextSide.innerBottom, thisSide.innerBottom, RED);
    pushFace(thisSide.innerBottom, nextSide.innerBottom, thisSide.innerTop);
    pushFace(nextSide.innerBottom, nextSide.innerTop, thisSide.innerTop);
    pushFace(thisSide.outerTop, thisSide.innerTop, nextSide.outerTop);
    pushFace(nextSide.outerTop, thisSide.innerTop, nextSide.innerTop);
  }
  return { vertices, faces };
}
```

(g) **Replace** `Prism.calcHighlightGeometry(target)` to return `LineGeometry` with plain points (use `lerp` instead of `Vector3.lerpVectors`):

```ts
calcHighlightGeometry(target: string): LineGeometry {
  let { vertices, outerBottomCenter, innerBottomCenter, topCenter, sideVertices } = this.calc3DVertices();
  const out: Vec3[] = [];
  if (target === "height") {
    out.push(vertices[innerBottomCenter], vertices[topCenter]);
  } else if (target === "topWidth") {
    const inner0 = vertices[sideVertices[0].innerTop];
    const inner1 = vertices[sideVertices[1].innerTop];
    const innerStart = lerp(inner0, inner1, 0.5);
    let innerEnd: Vec3;
    if (sideVertices.length % 2 === 0) {
      const half = Math.floor(sideVertices.length / 2);
      innerEnd = lerp(vertices[sideVertices[half].innerTop], vertices[sideVertices[half + 1].innerTop], 0.5);
    } else {
      const half = Math.ceil(sideVertices.length / 2);
      innerEnd = vertices[sideVertices[half].innerTop];
    }
    out.push(innerStart, innerEnd);
  } else if (target === "bottomWidth") {
    const inner0 = vertices[sideVertices[0].innerBottom];
    const inner1 = vertices[sideVertices[1].innerBottom];
    const innerStart = lerp(inner0, inner1, 0.5);
    let innerEnd: Vec3;
    if (sideVertices.length % 2 === 0) {
      const half = Math.floor(sideVertices.length / 2);
      innerEnd = lerp(vertices[sideVertices[half].innerBottom], vertices[sideVertices[half + 1].innerBottom], 0.5);
    } else {
      const half = Math.ceil(sideVertices.length / 2);
      innerEnd = vertices[sideVertices[half].innerBottom];
    }
    out.push(innerStart, innerEnd);
  } else if (target === "clayThickness") {
    const outerMid = lerp(vertices[sideVertices[0].outerTop], vertices[sideVertices[1].outerTop], 0.5);
    const innerMid = lerp(vertices[sideVertices[0].innerTop], vertices[sideVertices[1].innerTop], 0.5);
    out.push(outerMid, innerMid);
  } else {
    out.push(vertices[outerBottomCenter], vertices[innerBottomCenter]);
  }
  return { vertices: out };
}
```

(h) In `Conic`, keep `calc3DGeometry()` and `calcHighlightGeometry()` delegating to `getEquivalentPrism()` (unchanged — they now return the plain types). Annotate `calcHighlightGeometry(target: string)`.

- [ ] **Step 4: Delete the old JS module**

```bash
git rm src/lib/shape.js
```

- [ ] **Step 5: Run the golden tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — all 7 cases green. If a mesh/normal assertion fails, the face order or normal formula diverged; recheck against step 3(f). If an SVG string assertion fails on float formatting, switch that `toEqual` to a numeric tolerance comparison (parse the path numbers and compare with `toBeCloseTo`).

- [ ] **Step 6: Type-check**

Run: `npm run check`
Expected: no errors in `shape.ts` / `shape.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: port geometry math to TS with plain-mesh output, golden tests passing"
```

---

## Task 4: Port the 2D preview and control components to Svelte 5 runes

UI components are verified by `svelte-check` here and by the E2E task later (no per-component unit tests — they are presentational and covered end-to-end).

**Files:**
- Create: `src/lib/components/SpinnerSliderControl.svelte`
- Create: `src/lib/components/RadioSelector.svelte`
- Create: `src/lib/components/ShapePreview2D.svelte`
- Create: `src/lib/components/Nav.svelte`
- Delete (later, in Task 7): old `src/components/*`

- [ ] **Step 1: Create `src/lib/components/SpinnerSliderControl.svelte`**

`export let` → `$props()`, `value` is `$bindable`, slot → `children` snippet, event forwarding → `onmouseenter`/`onmouseleave` callback props.

```svelte
<script lang="ts">
  let {
    value = $bindable(),
    min = undefined,
    max = undefined,
    step = undefined,
    onmouseenter = undefined,
    onmouseleave = undefined,
    children,
  } = $props();
</script>

<fieldset {onmouseenter} {onmouseleave}>
  <label>
    {@render children?.()}
    <input type="range" {min} {max} {step} bind:value />
    <input type="number" {min} {max} {step} bind:value />
  </label>
</fieldset>
```

- [ ] **Step 2: Create `src/lib/components/RadioSelector.svelte`**

```svelte
<script lang="ts">
  import { v4 as uuid } from "uuid";

  let { value = $bindable(), options, children } = $props();

  let effectiveOptions = $derived(
    options.map((x: unknown) => (Array.isArray(x) ? x : [x, x]))
  );

  const id = uuid();
</script>

<style>
  div {
    display: flex;
    flex-flow: row nowrap;
  }
  div input[type="radio"] {
    display: none;
  }
  div input[type="radio"] + label {
    border: 2px solid var(--black);
    flex: 1;
    text-align: center;
    padding: 0 0.5em;
    white-space: nowrap;
  }
  div input[type="radio"] + label:nth-of-type(n + 2) {
    border-left-width: 1px;
  }
  div input[type="radio"] + label:nth-last-of-type(n + 2) {
    border-right-width: 1px;
  }
  div input[type="radio"]:checked + label {
    background-color: var(--mint);
    font-weight: bold;
  }
</style>

<fieldset>
  {@render children?.()}
  <div>
    {#each effectiveOptions as item (item[0])}
      <input type="radio" bind:group={value} value={item[0]} id="{id}-{item[0]}" />
      <label for="{id}-{item[0]}">{item[1]}</label>
    {/each}
  </div>
</fieldset>
```

- [ ] **Step 3: Create `src/lib/components/Nav.svelte`**

SvelteKit no longer passes `segment`; derive the active link from the page store.

```svelte
<script lang="ts">
  import { page } from "$app/stores";
</script>

<style>
  nav {
    border-bottom: 1px solid hsla(var(--brown-h), var(--brown-s), var(--brown-l), 0.2);
    font-weight: 300;
    padding: 0 1em;
  }
  ul {
    margin: 0;
    padding: 0;
  }
  ul::after {
    content: "";
    display: block;
    clear: both;
  }
  li {
    display: block;
    float: left;
  }
  [aria-current] {
    position: relative;
    display: inline-block;
  }
  [aria-current]::after {
    position: absolute;
    content: "";
    width: calc(100% - 1em);
    height: 2px;
    background-color: var(--brown);
    display: block;
    bottom: -1px;
  }
  a {
    text-decoration: none;
    padding: 1em 0.5em;
    display: block;
  }
</style>

<nav>
  <ul>
    <li>
      <a aria-current={$page.url.pathname === "/" ? "page" : undefined} href="/">home</a>
    </li>
    <li>
      <a aria-current={$page.url.pathname.startsWith("/edit") ? "page" : undefined} href="/edit">edit</a>
    </li>
  </ul>
</nav>
```

- [ ] **Step 4: Create `src/lib/components/ShapePreview2D.svelte`**

Convert `export let shape` → `$props()`, all `$:` derivations → `$state`/`$derived`, and the `on:wheel|preventDefault` modifier → an explicit `event.preventDefault()` in the handler (Svelte 5 removed event modifiers). The import path becomes `$lib/shape`.

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { convertUnits, type Units } from "$lib/shape";

  let { shape } = $props();

  let svg: SVGSVGElement;
  let svgWidth = $state(1);
  let svgHeight = $state(1);

  function peekSVGDimensions() {
    svgWidth = svg.clientWidth;
    svgHeight = svg.clientHeight;
  }

  onMount(peekSVGDimensions);

  let walls = $derived(shape.calcWalls());
  let creases = $derived(shape.calcCreaseMarkers());

  let centerX = $state(0);
  let centerY = $state(0);
  let zoom = $state(1);

  let strokeWidth = $derived(convertUnits(0.05, "cm", "px") * zoom);

  function px2svg(pxLen: number, units: Units, zoom: number) {
    return convertUnits(pxLen, "px", units) / zoom;
  }

  function clamp(val: number, min: number, max: number | undefined = undefined) {
    if (max === undefined) {
      if (min > 0) min = -min;
      max = -min;
    }
    if (val < min) return min;
    if (val > max) return max;
    return val;
  }

  let vbWidth = $derived(px2svg(svgWidth, shape.units, zoom));
  let vbHeight = $derived(px2svg(svgHeight, shape.units, zoom));

  $effect(() => {
    const bounds = shape.calcPDFBounds();
    centerX = clamp(centerX, bounds.left, bounds.right);
    centerY = clamp(centerY, bounds.top, bounds.bottom);
  });

  let dragLastX = 0;
  let dragLastY = 0;
  let dragging = false;

  function handleMouseDown(event: MouseEvent) {
    dragLastX = event.pageX;
    dragLastY = event.pageY;
    dragging = true;
  }
  function handleMouseMove(event: MouseEvent) {
    if (dragging) {
      const bounds = shape.calcPDFBounds();
      centerX = clamp(centerX - px2svg(event.pageX - dragLastX, shape.units, zoom), bounds.left, bounds.right);
      centerY = clamp(centerY - px2svg(event.pageY - dragLastY, shape.units, zoom), bounds.top, bounds.bottom);
      dragLastX = event.pageX;
      dragLastY = event.pageY;
    }
  }
  function handleMouseUp() {
    dragging = false;
  }
  function handleScroll(event: WheelEvent) {
    event.preventDefault();
    let oldSvgX = px2svg(event.offsetX - svgWidth / 2, shape.units, zoom);
    let oldSvgY = px2svg(event.offsetY - svgHeight / 2, shape.units, zoom);
    if (event.deltaY > 0) zoom /= 1.2;
    else zoom *= 1.2;
    let newSvgX = px2svg(event.offsetX - svgWidth / 2, shape.units, zoom);
    let newSvgY = px2svg(event.offsetY - svgHeight / 2, shape.units, zoom);
    centerX -= newSvgX - oldSvgX;
    centerY -= newSvgY - oldSvgY;
  }
</script>

<style>
  article {
    flex: 1 0 0;
    display: flex;
    flex-flow: column;
  }
  h2 {
    flex: 0;
  }
  svg {
    flex: 1;
    background-color: white;
  }
  path {
    vector-effect: non-scaling-stroke;
  }
</style>

<svelte:window on:resize={peekSVGDimensions} />

<article>
  <h2>Printed Template</h2>
  <svg
    bind:this={svg}
    viewBox="{centerX - vbWidth / 2} {centerY - vbHeight / 2} {vbWidth} {vbHeight}"
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onmouseleave={handleMouseUp}
    onwheel={handleScroll}>
    {#each walls as wall}
      <path d={wall} fill="none" stroke="#000000" stroke-width={strokeWidth} />
    {/each}
    {#each creases as crease}
      <path d={crease} fill="none" stroke="#000000" stroke-width={strokeWidth} stroke-dasharray="3" />
    {/each}
  </svg>
</article>
```

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: no errors in the three created components. (`ShapePreview3D` and the routes don't exist yet — ignore "cannot find" errors for those; this step gates only on the files created in this task.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: port 2D preview and control components to Svelte 5 runes"
```

---

## Task 5: Port the 3D preview to BufferGeometry + runes

**Files:**
- Create: `src/lib/components/ShapePreview3D.svelte`

- [ ] **Step 1: Create `src/lib/components/ShapePreview3D.svelte`**

Builds a non-indexed `BufferGeometry` from the plain `Mesh` (position + normal + color attributes), rebuilds it reactively via `$effect`, and renders with the same terracotta `MeshStandardMaterial({ vertexColors: true })`. The highlight line becomes a `BufferGeometry` with a position attribute.

```svelte
<script lang="ts">
  import * as THREE from "three";
  import { onMount } from "svelte";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import type { Mesh as ShapeMesh, LineGeometry } from "$lib/shape";

  let { shape, highlightTarget } = $props();

  let canvas: HTMLCanvasElement;

  function buildMeshGeometry(data: ShapeMesh): THREE.BufferGeometry {
    const positions = new Float32Array(data.faces.length * 9);
    const normals = new Float32Array(data.faces.length * 9);
    const colors = new Float32Array(data.faces.length * 9);
    let i = 0;
    for (const f of data.faces) {
      for (const idx of [f.a, f.b, f.c]) {
        const v = data.vertices[idx];
        positions[i] = v.x;
        positions[i + 1] = v.y;
        positions[i + 2] = v.z;
        normals[i] = f.normal.x;
        normals[i + 1] = f.normal.y;
        normals[i + 2] = f.normal.z;
        colors[i] = f.color.r;
        colors[i + 1] = f.color.g;
        colors[i + 2] = f.color.b;
        i += 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }

  function buildLineGeometry(data: LineGeometry): THREE.BufferGeometry {
    const positions = new Float32Array(data.vertices.length * 3);
    data.vertices.forEach((v, k) => {
      positions[k * 3] = v.x;
      positions[k * 3 + 1] = v.y;
      positions[k * 3 + 2] = v.z;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }

  let geometry = buildMeshGeometry(shape.calc3DGeometry());
  let highlightGeometry = buildLineGeometry(shape.calcHighlightGeometry(highlightTarget));

  let mesh: THREE.Mesh;
  let lines: THREE.Line;
  let camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;

  $effect(() => {
    const next = buildMeshGeometry(shape.calc3DGeometry());
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = next;
    }
    geometry = next;
  });

  $effect(() => {
    const next = buildLineGeometry(shape.calcHighlightGeometry(highlightTarget));
    if (lines) {
      lines.geometry.dispose();
      lines.geometry = next;
    }
    highlightGeometry = next;
  });

  let y = $derived(shape.height / 2);

  function peekDimensions() {
    canvas.width = 0;
    canvas.height = 0;
    canvas.setAttribute("style", "");
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.width / canvas.height;
    camera.updateProjectionMatrix();
  }

  onMount(() => {
    const scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0xffffff, 1);

    const light = new THREE.PointLight(0xffffff, 0.5, 0, 2);
    light.position.set(0, y * 3, 0);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const meshMaterial = new THREE.MeshStandardMaterial({ color: 0xe2725b, vertexColors: true });
    mesh = new THREE.Mesh(geometry, meshMaterial);
    scene.add(mesh);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x3333ff });
    lines = new THREE.Line(highlightGeometry, lineMaterial);
    scene.add(lines);

    camera.position.setZ(10);
    camera.position.setY(shape.height * 1.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target = new THREE.Vector3(0, y, 0);

    peekDimensions();

    let frame: number;
    (function loop() {
      frame = requestAnimationFrame(loop);
      controls.target.setY(y);
      controls.update();
      light.position.setY(y * 3);
      renderer.render(scene, camera);
    })();

    return () => cancelAnimationFrame(frame);
  });
</script>

<style>
  article {
    flex: 1 0 0;
    display: flex;
    flex-flow: column;
  }
  h2 {
    flex: 0;
  }
  canvas {
    flex: 1;
  }
</style>

<article>
  <h2>Constructed Shape</h2>
  <canvas width="200" height="200" bind:this={canvas}></canvas>
</article>
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no errors in `ShapePreview3D.svelte`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: port 3D preview to BufferGeometry + runes"
```

---

## Task 6: Port the edit page to runes

**Files:**
- Create: `src/routes/edit/+page.svelte`
- Delete: `src/routes/edit.svelte`

- [ ] **Step 1: Create `src/routes/edit/+page.svelte`**

`let` → `$state`, `$: shape`/`$: shapeExportQuery` → `$derived`, the two side-effecting `$:` blocks → `$effect`, component imports from `$lib/components/*`, and `on:mouseenter`/`on:mouseleave` → `onmouseenter`/`onmouseleave` props.

```svelte
<script lang="ts">
  import round from "lodash/round";
  import makeShape, { convertUnits, type Units } from "$lib/shape";
  import SpinnerSliderControl from "$lib/components/SpinnerSliderControl.svelte";
  import ShapePreview2D from "$lib/components/ShapePreview2D.svelte";
  import ShapePreview3D from "$lib/components/ShapePreview3D.svelte";
  import RadioSelector from "$lib/components/RadioSelector.svelte";

  let sidesSelection = $state("prism");
  let sides: number | "∞" = $state(4);
  let height = $state(5);
  let bottomWidth = $state(5);
  let topWidth = $state(5);
  let clayThickness = $state(0.25);
  let seamMode = $state("sides");
  let units: Units = $state("in");
  let pageSize = $state("letter");
  let highlightTarget = $state("");

  $effect(() => {
    if (sidesSelection === "prism" && sides === "∞") {
      sides = 4;
    } else if (sidesSelection === "circle" && sides !== "∞") {
      sides = "∞";
    }
    if (sidesSelection === "circle" && seamMode === "sides") {
      seamMode = "base";
    }
  });

  let shape = $derived(makeShape(sides, height, bottomWidth, topWidth, clayThickness, seamMode, units));

  let shapeExportQuery = $derived(
    new URLSearchParams({
      sides: String(sides),
      height: String(height),
      bottomWidth: String(bottomWidth),
      topWidth: String(topWidth),
      clayThickness: String(clayThickness),
      seamMode,
      units,
      pageSize,
    }).toString()
  );

  let oldUnits: Units = units;
  $effect(() => {
    if (units !== oldUnits) {
      const fixUnits = (q: number) => round(convertUnits(q, oldUnits, units), 1);
      height = fixUnits(height);
      bottomWidth = fixUnits(bottomWidth);
      topWidth = fixUnits(topWidth);
      clayThickness = fixUnits(clayThickness);
      oldUnits = units;
    }
  });
</script>

<style>
  article {
    display: flex;
    flex-flow: row;
    height: 100%;
    margin: 0;
  }
  article > :global(*) {
    flex: 1;
  }
  aside {
    flex: 0;
    margin: 0 0.5rem;
  }
</style>

<svelte:head>
  <title>slabforge | edit</title>
</svelte:head>

<article>
  <ShapePreview2D {shape} />
  <ShapePreview3D {shape} {highlightTarget} />
  <aside>
    <RadioSelector bind:value={sidesSelection} options={["prism", "circle"]} />
    {#if sidesSelection === "prism"}
      <SpinnerSliderControl bind:value={sides} min="3" step="1" max="20">Sides</SpinnerSliderControl>
    {/if}
    <SpinnerSliderControl
      bind:value={height}
      min="1"
      step="0.1"
      max="50"
      onmouseenter={() => (highlightTarget = "height")}
      onmouseleave={() => (highlightTarget = "")}>Height</SpinnerSliderControl>
    <SpinnerSliderControl
      bind:value={bottomWidth}
      min="1"
      step="0.1"
      max="50"
      onmouseenter={() => (highlightTarget = "bottomWidth")}
      onmouseleave={() => (highlightTarget = "")}>Bottom Width</SpinnerSliderControl>
    <SpinnerSliderControl
      bind:value={topWidth}
      min="1"
      step="0.1"
      max="50"
      onmouseenter={() => (highlightTarget = "topWidth")}
      onmouseleave={() => (highlightTarget = "")}>Top Width</SpinnerSliderControl>
    <SpinnerSliderControl
      bind:value={clayThickness}
      min="0.1"
      step="0.05"
      max="1"
      onmouseenter={() => (highlightTarget = "clayThickness")}
      onmouseleave={() => (highlightTarget = "")}>Clay Thickness</SpinnerSliderControl>
    <RadioSelector bind:value={seamMode} options={["sides", "base"]}>Seam</RadioSelector>
    <RadioSelector bind:value={units} options={["in", "cm"]} />
    <fieldset>
      <label>
        Page Size
        <select bind:value={pageSize}>
          <option value="letter">Letter</option>
          <option value="auto">Auto</option>
        </select>
      </label>
    </fieldset>
    <a href="/shape.pdf?{shapeExportQuery}">Download PDF</a>
    <a href="/shape.stl?{shapeExportQuery}">Download STL</a>
    <a href="/slump-mold.stl?{shapeExportQuery}">Download Slump Mold</a>
  </aside>
</article>
```

- [ ] **Step 2: Delete the old edit route**

```bash
git rm src/routes/edit.svelte
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no errors in `edit/+page.svelte`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: port edit page to Svelte 5 runes"
```

---

## Task 7: Port layout, home page, and error page

**Files:**
- Create: `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/+error.svelte`
- Delete: `src/routes/_layout.svelte`, `src/routes/index.svelte`, `src/routes/_error.svelte`, and the old `src/components/` directory

- [ ] **Step 1: Create `src/routes/+layout.svelte`**

`export let segment` is removed (Nav derives its own active state); `<slot/>` → `{@render children()}`.

```svelte
<script lang="ts">
  import Nav from "$lib/components/Nav.svelte";
  let { children } = $props();
</script>

<style>
  main {
    position: relative;
    padding: 2em;
    margin: 0 auto;
    box-sizing: border-box;
    flex: 1;
    width: 100%;
  }
</style>

<Nav />

<main>
  {@render children()}
</main>
```

- [ ] **Step 2: Create `src/routes/+page.svelte`** (home — markup only, unchanged)

```svelte
<svelte:head>
  <title>slabforge</title>
</svelte:head>

<style>
  h1,
  p {
    text-align: center;
    margin: 0 auto;
  }
  h1 {
    font-size: 2.8em;
    text-transform: uppercase;
    font-weight: 700;
    margin: 0 0 0.5em 0;
  }
  p {
    margin: 1em auto;
  }
  @media (min-width: 480px) {
    h1 {
      font-size: 4em;
    }
  }
</style>

<h1>slabforge</h1>

<p>it's for making slab ceramics.</p>

<p>
  source is on
  <a href="https://github.com/Hand-and-Machine/slabforge">GitHub</a>
  .
</p>
```

- [ ] **Step 3: Create `src/routes/+error.svelte`**

SvelteKit error pages read `$page.status` / `$page.error`; the dev flag comes from `$app/environment`.

```svelte
<script lang="ts">
  import { page } from "$app/stores";
  import { dev } from "$app/environment";
</script>

<style>
  h1,
  p {
    margin: 0 auto;
  }
  h1 {
    font-size: 2.8em;
    font-weight: 700;
    margin: 0 0 0.5em 0;
  }
  p {
    margin: 1em auto;
  }
  @media (min-width: 480px) {
    h1 {
      font-size: 4em;
    }
  }
</style>

<svelte:head>
  <title>{$page.status}</title>
</svelte:head>

<h1>{$page.status}</h1>

<p>{$page.error?.message}</p>

{#if dev}
  <pre>{$page.status}</pre>
{/if}
```

- [ ] **Step 4: Delete old route/component files**

```bash
git rm src/routes/_layout.svelte src/routes/index.svelte src/routes/_error.svelte
git rm -r src/components
```

- [ ] **Step 5: Start the dev server and verify pages load**

Run: `npm run dev` (in the background), then in another shell: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/ && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/edit`
Expected: both return `200`. Stop the dev server afterward.

- [ ] **Step 6: Type-check**

Run: `npm run check`
Expected: zero errors across the whole project (all Svelte files now exist; endpoints come next but should not produce errors in these files).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: port layout, home, and error routes to SvelteKit"
```

---

## Task 8: Port the STL endpoints

**Files:**
- Create: `src/routes/shape.stl/+server.ts`
- Create: `src/routes/slump-mold.stl/+server.ts`
- Delete: `src/routes/shape.stl.js`, `src/routes/slump-mold.stl.js`

- [ ] **Step 1: Create `src/routes/shape.stl/+server.ts`**

Reads params from `event.url.searchParams`, builds the binary STL `Buffer` exactly as the old code did (the `writeVector` y/z swap is preserved), and returns a `Response`. No three.js — the plain `Mesh` supplies `faces[].normal` and `vertices[]`.

```ts
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
```

- [ ] **Step 2: Create `src/routes/slump-mold.stl/+server.ts`**

Same as above but with the slump-mold parameter adjustments from the legacy file (height/widths offset by clay thickness, fixed 0.5cm thickness), and the stray `console.log`s removed.

```ts
import { Buffer } from "node:buffer";
import type { RequestHandler } from "./$types";
import makeShape, { convertUnits, type Vec3, type Units } from "$lib/shape";

function writeVector(buffer: Buffer, vector: Vec3, position: number): number {
  position = buffer.writeFloatLE(vector.x, position);
  position = buffer.writeFloatLE(vector.z, position);
  position = buffer.writeFloatLE(vector.y, position);
  return position;
}

export const GET: RequestHandler = ({ url }) => {
  const p = Object.fromEntries(url.searchParams.entries());
  const units = p.units as Units;
  const ct = parseFloat(p.clayThickness);
  const shape = makeShape(
    p.sides === "∞" ? "∞" : Number(p.sides),
    parseFloat(p.height) + ct,
    parseFloat(p.bottomWidth) + ct,
    parseFloat(p.topWidth) + ct,
    convertUnits(0.5, "cm", units),
    p.seamMode,
    units
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
  const filename = `slabforge-${type}-${p.height}-${p.bottomWidth}-${p.topWidth}-${p.clayThickness}-${units}-slump-mold.stl`;
  return new Response(result, {
    headers: {
      "Content-Type": "model/x.stl-binary",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
```

- [ ] **Step 3: Delete the old STL endpoints**

```bash
git rm src/routes/shape.stl.js src/routes/slump-mold.stl.js
```

- [ ] **Step 4: Verify the endpoints return binary STL**

Run `npm run dev` in the background, then:
`curl -s -D - -o /tmp/s.stl "http://localhost:5173/shape.stl?sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in" | grep -i content-type && wc -c < /tmp/s.stl`
Expected: `Content-Type: model/x.stl-binary` and a byte count of `84 + 50 * (8 faces * 4 sides)`-ish (non-zero, > 84). Repeat for `/slump-mold.stl`. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: port STL endpoints to SvelteKit +server (three.js-free)"
```

---

## Task 9: Port the PDF endpoint

**Files:**
- Create: `src/routes/shape.pdf/+server.ts`
- Delete: `src/routes/shape.pdf.js`

- [ ] **Step 1: Create `src/routes/shape.pdf/+server.ts`**

Copy the entire body of the current `src/routes/shape.pdf.js` (the `calcScale`, `labelBevelGuide`, `drawTemplate`, `drawArrow`, `drawTapeInstructions`, `drawCutTemplateInstructions`, `drawCutClayInstructions`, `drawAssembleInstructions`, `drawInstructions` functions — **verbatim**) into the new file, then change three things:

1. Replace the import line `import PDFDocument from "pdfkit";` with the standalone bundle (avoids runtime AFM font-file resolution under Vite/adapter-node): `import PDFDocument from "pdfkit/js/pdfkit.standalone.js";`
2. Replace the import `import makeShape, { convertUnits } from "../lib/shape.js";` with `import makeShape, { convertUnits } from "$lib/shape";`
3. Replace the `export async function get(req, res, next) { ... }` handler with the SvelteKit `GET` handler below, which reads params from `event.url`, buffers pdfkit output, and returns a `Response`. The drawing logic between "create doc" and "doc.end()" is unchanged.

```ts
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { Buffer } from "node:buffer";
import type { RequestHandler } from "./$types";
import makeShape, { convertUnits } from "$lib/shape";

// ---- paste calcScale, fontSize, labelBevelGuide, drawTemplate, drawArrow,
// ---- drawTapeInstructions, drawCutTemplateInstructions, drawCutClayInstructions,
// ---- drawAssembleInstructions, drawInstructions here VERBATIM from shape.pdf.js ----

export const GET: RequestHandler = async ({ url }) => {
  const params = Object.fromEntries(url.searchParams.entries());
  let { sides, height, bottomWidth, topWidth, clayThickness, seamMode, units, pageSize, noDownload } = params as Record<string, string>;

  const shape = makeShape(
    sides === "∞" ? "∞" : Number(sides),
    height,
    bottomWidth,
    topWidth,
    clayThickness,
    seamMode,
    units as any
  );

  const scale = calcScale(shape.units);
  const shapeBounds = shape.calcPDFBounds();
  const bounds = {
    left: shapeBounds.left * scale,
    right: shapeBounds.right * scale,
    top: shapeBounds.top * scale,
    bottom: shapeBounds.bottom * scale,
  };
  const minPDFWidth = bounds.right - bounds.left;
  const minPDFHeight = bounds.bottom - bounds.top;

  let size: string | [number, number] = pageSize;
  if (pageSize === "auto") {
    size = [minPDFWidth + 72, minPDFHeight + 72];
  }

  const doc = new PDFDocument({ size, margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const pageMargin = doc.page.margins.top;
  const pageContentWidth = doc.page.width - 2 * pageMargin;
  const pageContentHeight = doc.page.height - 2 * pageMargin;

  const widthPages = Math.ceil(minPDFWidth / pageContentWidth);
  const heightPages = Math.ceil(minPDFHeight / pageContentHeight);

  const shapeWalls = shape.calcWalls();
  const shapeCreases = shape.calcCreaseMarkers();
  const shapeBevelMarkers = shape.calcBevelMarkers();

  let bevelGuidePath = shapeWalls[shapeWalls.length - 1];
  let bevelGuidePositionMatch = /L [\-.\d]+,[\-.\d]+ ([\-.\d]+),([\-.\d]+)/.exec(bevelGuidePath)!;
  let bevelGuideX = parseFloat(bevelGuidePositionMatch[1]);
  let bevelGuideY = parseFloat(bevelGuidePositionMatch[2]);

  let templateSettings = {
    widthPages,
    heightPages,
    scale,
    shapeWalls,
    shapeCreases,
    shapeBevelMarkers,
    bevelGuideX,
    bevelGuideY,
    units,
    bounds: shapeBounds,
  };

  drawInstructions(doc, sides, shape, templateSettings);
  doc.addPage();

  for (let pageY = 0; pageY < heightPages; pageY++) {
    for (let pageX = 0; pageX < widthPages; pageX++) {
      doc.rect(pageMargin, pageMargin, pageContentWidth, pageContentHeight).stroke("#AAA");
      doc.strokeColor("black");
      drawTemplate(doc, templateSettings, {
        safeX: pageMargin,
        safeY: pageMargin,
        safeWidth: pageContentWidth,
        safeHeight: pageContentHeight,
        pageX,
        pageY,
        extraScale: 1,
      });
      if (pageX < widthPages - 1 || pageY < heightPages - 1) {
        doc.addPage();
      }
    }
  }

  doc.end();
  await finished;
  const body = Buffer.concat(chunks);

  const headers: Record<string, string> = { "Content-Type": "application/pdf" };
  if (!noDownload) {
    const type = sides === "∞" ? "circle" : "prism-" + sides;
    headers["Content-Disposition"] = `attachment; filename="slabforge-${type}-${height}-${bottomWidth}-${topWidth}-${clayThickness}-${seamMode}-${units}.pdf"`;
  }
  return new Response(body, { headers });
};
```

Note: the pasted drawing functions are plain JS; if `svelte-check` flags implicit-`any` parameters in them, add `// @ts-nocheck` as the first line of the file (acceptable for this faithfully-ported drawing code) rather than retyping every pdfkit call.

- [ ] **Step 2: Delete the old PDF endpoint**

```bash
git rm src/routes/shape.pdf.js
```

- [ ] **Step 3: Verify the endpoint returns a valid PDF**

Run `npm run dev` in the background, then:
`curl -s -D - -o /tmp/s.pdf "http://localhost:5173/shape.pdf?sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter" | grep -i content-type && head -c 5 /tmp/s.pdf`
Expected: `Content-Type: application/pdf` and the file begins with `%PDF-`. Test the conic case too (`sides=∞`, `pageSize=auto`). Stop the dev server.

- [ ] **Step 4: Type-check and unit tests**

Run: `npm run check && npm run test:unit`
Expected: check passes (or only the accepted `@ts-nocheck` on the PDF file); all golden unit tests still pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: port PDF endpoint to SvelteKit +server (pdfkit standalone)"
```

---

## Task 10: Playwright E2E

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/edit.test.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  webServer: {
    command: "npm run build && npm run preview",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  testDir: "e2e",
  use: { baseURL: "http://localhost:4173" },
});
```

- [ ] **Step 2: Install the Playwright browser**

Run: `npx playwright install chromium`
Expected: chromium downloads successfully.

- [ ] **Step 3: Write the E2E test**

Create `e2e/edit.test.ts`:

```ts
import { test, expect } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("slabforge");
});

test("edit page shows both previews and renders SVG template", async ({ page }) => {
  await page.goto("/edit");
  // 3D preview canvas present
  await expect(page.locator("canvas")).toBeVisible();
  // 2D preview has at least one wall path
  await expect(page.locator("svg path").first()).toBeVisible();
});

test("changing sides updates the template", async ({ page }) => {
  await page.goto("/edit");
  const before = await page.locator("svg path").count();
  // switch to circle
  await page.getByText("circle", { exact: true }).click();
  await expect(page.locator("svg path").first()).toBeVisible();
  expect(before).toBeGreaterThan(0);
});

test("download endpoints return the right content types", async ({ request }) => {
  const q = "sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter";
  const pdf = await request.get(`/shape.pdf?${q}`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const stl = await request.get(`/shape.stl?${q}`);
  expect(stl.headers()["content-type"]).toBe("model/x.stl-binary");
  const slump = await request.get(`/slump-mold.stl?${q}`);
  expect(slump.headers()["content-type"]).toBe("model/x.stl-binary");
});
```

- [ ] **Step 4: Run the E2E suite**

Run: `npm run test:e2e`
Expected: all 4 tests PASS (Playwright builds, previews and downloads work end to end).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: add Playwright E2E for pages and download endpoints"
```

---

## Task 11: Production build + Dockerfile

**Files:**
- Create: `Dockerfile`
- Create/Modify: `.dockerignore`

- [ ] **Step 1: Verify the adapter-node production build runs**

Run: `npm run build && (PORT=3000 node build &) && sleep 2 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ && curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/shape.stl?sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in"`
Expected: `build/` is produced; both curls return `200`. Kill the node process afterward (`kill %1` or `pkill -f 'node build'`).

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.svelte-kit
build
.git
cypress
e2e
test-results
playwright-report
```

- [ ] **Step 3: Create `Dockerfile`**

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
ENV PORT=3000
CMD ["node", "build"]
```

- [ ] **Step 4: Build and smoke-test the Docker image** (if Docker is available locally)

Run: `docker build -t slabforge . && docker run -d -p 3001:3000 --name slabforge-test slabforge && sleep 3 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/ && docker rm -f slabforge-test`
Expected: image builds; curl returns `200`. (If Docker isn't available locally, skip this step and note it for the devops handoff.)

- [ ] **Step 5: Update README run instructions**

Replace the Sapper-era run instructions in `README.md` with the SvelteKit commands: `npm install`, `npm run dev` (port 5173), `npm run build` + `node build` for production, `npm run test:unit`, `npm run test:e2e`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: add adapter-node Dockerfile and update README"
```

- [ ] **Step 7: Hand off to devops**

After merging, message the devops agent to deploy on the Contabo VPS (Docker build from the repo, Traefik routing). This is outside the GitHub Actions deploy workflow if one isn't yet wired for this project.

---

## Self-Review Notes

- **Spec coverage:** §1 route mapping → Tasks 6–9; §2/§3 three.js decoupling → Task 3 + Task 5; §4 endpoint model → Tasks 8–9; §5 runes → Tasks 4–7; §6 TypeScript → Tasks 2–3; §7 testing → Tasks 1, 3 (Vitest golden), 10 (Playwright); §8 deploy → Task 11; §9 PWA assets → Task 2 (`app.html` links, `static/` untouched), service worker dropped in Task 2 (Sapper file deletion). All spec sections map to tasks.
- **Fidelity:** Golden fixture captured from legacy code in Task 1; Task 3 proves the math survives. Mesh compared with `toBeCloseTo(…, 6)` to allow float drift (spec: visually equivalent).
- **Known accepted shortcuts:** `@ts-nocheck` permitted on the verbatim-ported PDF drawing code; `Conic.getEquivalentPrism()`'s latent arg-order quirk is preserved deliberately (it doesn't affect 3D output, and golden tests lock current behavior).
