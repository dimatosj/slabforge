# slabforge — Tier 1 Correctness Fixes Design

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Goal

Fix four silent-correctness defects surfaced by the post-migration deep dive, all of which undermine slabforge's core promise of dimensional accuracy. These are behavior-preserving where the current behavior is correct, and behavior-*correcting* where it is wrong. A fifth deep-dive item — the odd-sided "width" convention — is **deferred to its own pass** (it's a convention/clarity decision, not a clear bug).

## Decisions (locked)

| Topic | Decision |
|---|---|
| Width convention (odd-sided) | **Deferred** — not in this batch |
| `bottomWidth`/`topWidth` meaning | **Interior** finished dimension, consistently everywhere |
| Invalid input (UI) | Silently clamp number fields to `[min,max]`; empty/NaN → `min` |
| Invalid input (endpoints) | Validate; return **400** with a message on bad params |
| STL units | Export in **mm** (scale design units → mm); add `"mm"` to `convertUnits` |
| Golden fixtures | Regenerate the base-seam/conic entries from corrected code; sides-seam entries must stay byte-identical |

## Scope (4 fixes)

### Fix 1 — STL exports at real-world size (millimeters)

**Problem.** `shape.stl/+server.ts` and `slump-mold.stl/+server.ts` write raw design-unit coordinates into the binary STL. STL is unitless and slicers assume millimeters, so a `5 in` vessel imports as 5 mm (and a `5 cm` vessel as 5 mm — 10× small). Every 3D export is unusably tiny.

**Fix.**
- Add `"mm"` to `convertUnits` in `src/lib/shape.ts`. The function pivots through points; `1 cm = 28.35 pt`, so `1 mm = 2.835 pt`. Add both directions (from-mm: `quantityPt = quantity * 2.835`; to-mm: `return quantityPt / 2.835`).
- Extract the binary-STL serialization (currently duplicated in both endpoints, including the Y/Z swap for z-up viewers) into a pure module `src/lib/stl.ts`:
  ```ts
  // meshToBinarySTL(mesh: Mesh, scale: number): Buffer
  // - 80-byte header, UInt32LE face count, per face: normal + 3 vertices + UInt16LE 0
  // - writeVector swaps y/z (z-up). `scale` multiplies VERTEX coordinates only; the
  //   per-facet normal is a unit direction and is written unscaled.
  ```
- Both endpoints build the mesh from `shape.calc3DGeometry()` and call `meshToBinarySTL(mesh, convertUnits(1, units, "mm"))`.
- `shape.ts`'s mesh stays in design units; scaling happens only at export, so the geometry golden tests are unaffected.

**Why normals aren't scaled.** A uniform positive scale does not change a normalized direction; the STL facet normal must remain unit-length, so it is written as-is.

**Tests.** Unit-test `src/lib/stl.ts`: (a) a 1-triangle mesh with `scale=2` produces vertex floats doubled and the normal unchanged; (b) the y/z swap is present; (c) total byte length `= 84 + 50 * faceCount`. Unit-test `convertUnits(5, "in", "mm") === 127` (within float tolerance) and `convertUnits(5, "cm", "mm") === 50`.

### Fix 2 — Input validation

**Problem.** All three export endpoints are reachable by direct URL and do no validation: `Number(sides)`/`parseFloat(...)` yield `NaN` on garbage, producing a corrupt-but-valid STL download, an unhandled 500 in the PDF route (`calcPDFBounds` → `NaN` page counts; the `bevelGuidePositionMatch` regex can be `null` → `parseFloat(null[1])` throws), and degenerate geometry for `sides < 3`. In the editor, the number inputs carry `min`/`max` attributes but HTML does not clamp typed values, so `0`, negative, huge, or empty entries flow straight into `makeShape` and blank the previews with no feedback.

**Fix (endpoints).** New shared module `src/lib/shapeParams.ts`:
```ts
export class ShapeParamError extends Error {}
export interface ShapeParams {
  sides: number | "∞";
  height: number; bottomWidth: number; topWidth: number; clayThickness: number;
  seamMode: "sides" | "base";
  units: Units;
  pageSize: string;   // "letter" | "auto" (pdf only; default "letter")
}
export function parseShapeParams(sp: URLSearchParams): ShapeParams;
```
Rules: `sides` is `"∞"` or an integer in `[3, 20]`; `height`, `bottomWidth`, `topWidth`, `clayThickness` are finite and `> 0`; `seamMode ∈ {"sides","base"}`; `units ∈ {"in","cm"}`; `pageSize ∈ {"letter","auto"}` (defaulting to `"letter"`). Any violation throws `ShapeParamError` with a human-readable message. Each endpoint wraps the parse in `try/catch` and returns `new Response(message, { status: 400 })` on failure. This also de-duplicates the `Object.fromEntries` + `makeShape` boilerplate currently repeated in all three endpoints.

**Fix (UI).** In `src/lib/components/SpinnerSliderControl.svelte`, the number input clamps on change: parse the entry, and if it is empty/`NaN` set it to `min`, otherwise clamp to `[min, max]` (using the `min`/`max` props). The range input already clamps natively. Silent correction (no error text or `aria-invalid`) — matches the slider's behavior and keeps scope tight. The bound `value` is only ever written a valid, in-range number.

**Tests.** Unit-test `parseShapeParams`: a valid query returns typed params (including `"∞"` and `pageSize` default); invalid cases throw `ShapeParamError` — non-finite numbers, `sides=2`, `sides=25`, `height=0`, negative width, unknown `seamMode`/`units`. (The `SpinnerSliderControl` clamp is verified via the existing Playwright E2E plus manual reasoning; no new component unit test.)

### Fix 3 — Base-seam interior consistency

**Problem.** `bottomWidth`/`topWidth` are interpreted inconsistently. The 3D model (`calc3DVertices`: `innerBottom` at `bottomRadius`) and the sides-seam fold polygon (`calcCreaseMarkers`) treat width as the **interior** dimension, but the base-seam base outline (`Prism.calcWallsBaseSeam`, drawn at `bottomRadius + clayThickness`) and the cone base (`Conic.calcWalls`: `outerBottomRadius = bottomRadius + clayThickness`, `outerBottomWidth = bottomWidth + 2*clayThickness`) use the **exterior** dimension. So base-seam pots come out about `2 × clayThickness` too large at the base, and the printed base disagrees with the 3D preview.

**Fix.** Make the base outlines use the **interior** radius, consistent with the rest:
- `Prism.calcWallsBaseSeam`: the base polygon loop uses `bottomRadius` (not `bottomRadius + clayThickness`) for the radial term. Leave the layout `+ bottomRadius + 1` vertical offset and the `+ 1`/`+ 2` spacing constants as-is (pure layout, not dimensional).
- `Conic.calcWalls`: `outerBottomRadius → bottomRadius`, `outerBottomWidth → bottomWidth`, and the bevel-guide positioning that derives from `outerBottomWidth` recomputes from the interior value.
- Add a comment in both methods documenting "width = interior finished dimension."

**Caveat (recorded).** Whether the base slab should match the interior or exterior footprint depends on the exact construction method (walls wrapping around the base vs. seated on top). This implements the interior reading per the locked decision; the change is localized and one-line-reversible if the maker community prefers otherwise.

**Tests / golden.** This changes base-seam (`seamMode="base"`) and conic geometry. Regenerate the affected entries in `test-fixtures/golden-geometry.json` from the corrected code (see Golden Strategy). Verify by diff that sides-seam cases (`sides=4/3/5`, `seamMode="sides"`) remain byte-identical and only the base-outline coordinates of the base-seam/conic cases changed. Add an explicit assertion in `shape.test.ts` that, for a base-seam prism, the first base-outline vertex magnitude equals `bottomRadius` (interior), not `bottomRadius + clayThickness`.

### Fix 4 — PDF-bounds exponent regex

**Problem.** `Prism.calcPDFBounds` extracts coordinates from the SVG path strings with a regex whose exponent branch is `e-?\d+` — it accepts `e-7` but not the `+` that JS uses for large magnitudes (`(1e21).toString() === "1e+21"`). Near-cylindrical cones produce very large radii; such a coordinate is truncated (`2e+21` parsed as `2`), corrupting the bounding box → wrong page count / clipped template, emitted with no error. The `bevelGuidePositionMatch` regex in `shape.pdf/+server.ts` has the same exponent gap.

**Fix.**
- In `calcPDFBounds`, change both capture groups' exponent branch to `(?:e[+-]?\d+)?`.
- In `shape.pdf/+server.ts`, update `bevelGuidePositionMatch` to accept exponents and add a null-guard (skip the bevel-guide label if no match rather than throwing).

**Scope note.** Coordinate *rounding* (emitting 3–4 significant digits instead of full float precision) was a separate deep-dive item; it would change every path string and is **out of scope** here. This fix is the regex only.

**Tests.** Add a unit test using a near-cylinder cone (e.g. `bottomWidth = 5`, `topWidth = 5.0000001`) that forces an `e+` coordinate in the wall path; assert `calcPDFBounds` returns finite `top/bottom/left/right` whose magnitudes match the actual coordinate extents (recomputed independently in the test with an exponent-aware parser), rather than the truncated mantissa.

## Golden Strategy

The original `scripts/capture-golden.ts` imported the now-deleted `src/lib/shape.js`. Repoint a regeneration step at the new `$lib/shape` (run via `tsx`) and regenerate `test-fixtures/golden-geometry.json`. Because Fixes 1, 2, and 4 do not change `shape.ts`'s mesh/wall output (Fix 1 scales only at export; Fix 2 is endpoint/UI; Fix 4's regex only affects `calcPDFBounds` for exponential coordinates absent from the 7-case matrix), the only entries that change are the base-seam and conic cases from Fix 3. Procedure: regenerate, `git diff` the fixture, and confirm the only changed numbers are the base-outline coordinates of the base-seam/conic cases. The regenerated values become the forward-looking regression reference; the explicit `bottomRadius` assertion (Fix 3) guards against a blind snapshot.

## Architecture / new boundaries

- `src/lib/stl.ts` — pure binary-STL serialization (`meshToBinarySTL(mesh, scale)`), consumed by both STL endpoints. Removes duplicated `writeVector`/buffer logic.
- `src/lib/shapeParams.ts` — pure param parsing/validation (`parseShapeParams`, `ShapeParamError`), consumed by all three export endpoints. Removes duplicated coercion boilerplate.
- Both are small, single-responsibility, and unit-testable in isolation.

## Out of scope

- Odd-sided width convention (deferred).
- Coordinate-precision rounding in path strings.
- Slump-mold semantics, assembly-instruction diagram, STL manifold/winding audit, 3D-preview resize/dispose, mobile/touch, accessibility, URL-state persistence, in-editor specs panel (all separate deep-dive tiers/items).

## Success criteria

1. STL downloads import at correct real-world size in a slicer (5 in → 127 mm); `meshToBinarySTL` unit tests pass.
2. Malformed/out-of-range export URLs return 400, not corrupt files or 500s; the editor's number inputs cannot push an out-of-range/NaN value into a preview.
3. Base-seam and conic base outlines use the interior dimension, matching the 3D preview; golden fixtures regenerated with only the expected coordinates changed; the interior-radius assertion passes.
4. `calcPDFBounds` returns correct finite bounds for near-cylindrical cones; the regex test passes.
5. `npm run check` clean; `npm run test:unit` green (regenerated golden + new `stl`/`shapeParams` tests); `npm run test:e2e` green; `npm run build` succeeds.
