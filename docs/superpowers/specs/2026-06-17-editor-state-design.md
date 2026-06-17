# slabforge — "Make It a Real Tool" Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

Turn the slabforge editor from a session-only toy into a tool you can return to and share: persist the design in the URL (+ localStorage), surface the already-computed fabrication numbers in the editor, make unit toggling lossless, and fix three latent 3D-preview defects (NaN camera aspect, no resize handling, WebGL leak on navigation).

## Decisions (locked)

| Topic | Decision |
|---|---|
| Unit conversion | Keep per-unit storage; convert on toggle at higher precision (round to 4 decimals) — eliminates drift, minimal change |
| Persistence | URL is the source of truth; bare `/edit` restores last design from localStorage, else defaults |
| Editor SSR | `export const ssr = false` for the `/edit` route only (home page keeps SSR) |
| Specs panel | Bevel angle, wall length, page count (finished dimensions omitted — already the inputs) |

## Scope (4 parts)

### Part 1 — Design persistence (URL + localStorage)

The "design" is the 8 export params already serialized for the download links: `sides`, `height`, `bottomWidth`, `topWidth`, `clayThickness`, `seamMode`, `units`, `pageSize`. (`highlightTarget` is transient UI; `sidesSelection` is derived from `sides === "∞"`.) The type is the existing `ShapeParams` from `$lib/shapeParams.ts`.

**New `src/lib/design.ts`** (pure where possible):
- `DEFAULT_PARAMS: ShapeParams` — `{ sides: 4, height: 5, bottomWidth: 5, topWidth: 5, clayThickness: 0.25, seamMode: "sides", units: "in", pageSize: "letter" }`.
- `LS_KEY = "slabforge:lastDesign"`.
- `serializeDesign(p: ShapeParams): string` — builds the `URLSearchParams` query string (the single canonical serializer). The editor's `shapeExportQuery` derived value and the download-link hrefs both route through this.
- `parseDesignQuery(qs: string): ShapeParams | null` — `try { return parseShapeParams(new URLSearchParams(qs)); } catch { return null; }`. Lenient wrapper around the strict endpoint parser.
- `loadDesign(url: URL): ShapeParams` — precedence: if `url.searchParams.has("sides")` try `parseShapeParams(url.searchParams)`; else try `parseDesignQuery(localStorage.getItem(LS_KEY))`; else `{ ...DEFAULT_PARAMS }`. Any failure falls through to the next source. (Reads `localStorage`, so only called client-side — see SSR decision.)
- `convertValue(q: number, from: Units, to: Units): number` — `round(convertUnits(q, from, to), 4)` (see Part 3).
- `estimatePageCount(shape, units, pageSize): number` — see Part 2.

**New `src/routes/edit/+page.ts`:**
```ts
export const ssr = false;
export function load({ url }) {
  return { design: loadDesign(url) };
}
```
`ssr = false` makes the editor client-rendered (it already requires JS for the WebGL/canvas previews), so `load` runs only in the browser and can read both the URL and localStorage in one place with no hydration mismatch. The home route is unaffected.

**`edit/+page.svelte`:**
- Receive `let { data } = $props()`; initialize each `$state` field from `data.design`. Set `sidesSelection = data.design.sides === "∞" ? "circle" : "prism"`.
- Keep the existing `sidesSelection`/`seamMode` sync `$effect` and the units `$effect` (the latter modified per Part 3).
- `shapeExportQuery` becomes `$derived(serializeDesign({ sides, height, bottomWidth, topWidth, clayThickness, seamMode, units, pageSize }))`.
- Add a debounced persist `$effect`: on `shapeExportQuery` change, after ~200 ms, call `replaceState('?' + shapeExportQuery, {})` (from `$app/navigation`) and `localStorage.setItem(LS_KEY, shapeExportQuery)`. Debounce so slider drags don't thrash; `replaceState` (not `pushState`) so history isn't polluted. Clear the pending timeout on teardown.
- Download links keep using `shapeExportQuery` (now the shared serializer's output).

### Part 2 — In-editor specs panel

A read-only block in the `<aside>`, values `$derived` from `shape`:
- **Bevel angle:** `shape.bevelAngleDegrees ?? 45` (Conic has no getter → `undefined` → 45, matching the PDF's `|| 45`), shown as `…°`.
- **Wall length:** `shape.doMath().wallLength` (a public method on both classes), shown in the active `units` to 2 decimals.
- **Page count:** `estimatePageCount(shape, units, pageSize)`, shown as "Prints on N Letter page(s)" (or "1 page (auto-sized)" when `pageSize === "auto"`).

**`estimatePageCount(shape, units, pageSize)`** in `design.ts`, mirroring the PDF endpoint's math: `scale = convertUnits(1, units, "pt")`; `b = shape.calcPDFBounds()`; `minW = (b.right - b.left) * scale`, `minH = (b.bottom - b.top) * scale`. For `"auto"` return 1. For `"letter"`: US-Letter is 612×792 pt with a 36 pt margin → content 540×720 pt; `return Math.ceil(minW / 540) * Math.ceil(minH / 720)`. (The page/margin constants match the PDF endpoint's `PDFDocument({ size: pageSize, margin: 36 })`; document them as such.)

### Part 3 — Lossless-enough unit conversion

The drift comes solely from `round(convertUnits(q, oldUnits, units), 1)` in the units `$effect`. Replace each conversion with `convertValue(q, oldUnits, units)` (rounds to 4 decimals). Round-trip check: `0.25 in → convertValue → 0.635 cm → convertValue → 0.25 in` (exact); the old code produced `0.25 → 0.6 → 0.2` (20% loss on clay thickness). Slider `step` values stay unit-fixed (a separate concern, out of scope).

### Part 4 — 3D-preview robustness (`src/lib/components/ShapePreview3D.svelte`)

- **NaN aspect:** rewrite `peekDimensions` to capture `clientWidth`/`clientHeight` into locals before/after the existing zeroing trick, use them for both `renderer.setSize(w, h, false)` and `camera.aspect = h === 0 ? 1 : w / h`, and guard `if (!renderer || !camera) return;`.
- **Resize:** add `<svelte:window onresize={peekDimensions} />`.
- **Disposal:** extend the `onMount` cleanup (currently only `cancelAnimationFrame`) to also call `controls.dispose()`, `renderer.dispose()`, dispose both materials (`meshMaterial`, `lineMaterial`), and `mesh.geometry.dispose()` / `lines.geometry.dispose()`. (These locals are in scope of the returned cleanup closure.)

## Architecture / boundaries

- `src/lib/design.ts` — editor-side design state: defaults, (de)serialization, lenient load with URL→localStorage→default precedence, the unit-conversion rounding helper, and the page-count estimate. Pure functions except `loadDesign` (reads localStorage). Reuses the strict `parseShapeParams` rather than re-implementing validation.
- `src/routes/edit/+page.ts` — route config (`ssr=false`) + `load`.
- The `+page.svelte` changes are wiring (init from `data`, persist effect, specs markup); no new responsibilities beyond what's listed.

## Testing

- **Unit (`src/lib/design.test.ts`):**
  - `serializeDesign` → `parseDesignQuery` round-trips to the same params.
  - `parseDesignQuery` returns `null` for invalid/missing (e.g. `"sides=2&…"`, `""`).
  - `convertValue` round-trip stability: `convertValue(convertValue(0.25, "in", "cm"), "cm", "in") === 0.25`.
  - `estimatePageCount`: a small shape on letter → 1; a large shape (e.g. tall conic) → > 1; auto → 1.
- **E2E (extend `e2e/edit.test.ts`):**
  - Navigate to `/edit?sides=6&height=6&bottomWidth=4&topWidth=7&clayThickness=0.3&seamMode=base&units=cm&pageSize=letter`; assert the Sides number input reads `6` (URL hydrates state).
  - Change a control (e.g. set height), reload `/edit` (bare), assert the changed value persists (localStorage restore).
  - Assert the specs panel renders a bevel-angle value.
  - Resize the viewport; assert the 3D `canvas` is still visible (resize handler doesn't throw).

## Out of scope

- Slider `step`/min/max harmonization across units.
- Canonical-unit internal storage (chose higher-precision conversion instead).
- Finished-dimension readouts in the specs panel.
- Anything from other deep-dive tiers (print-scale/registration marks, assembly diagram, slump-mold rework, mobile/touch, accessibility, width convention).

## Success criteria

1. Adjusting controls updates the URL (via `replaceState`); copying the URL into a new tab reproduces the design; a bare `/edit` after editing restores the last design from localStorage.
2. Toggling units in↔cm does not drift values (clay thickness 0.25 in survives a round-trip).
3. The editor shows bevel angle, wall length, and page count, matching the PDF.
4. The 3D preview resizes with the window, has no NaN aspect, and disposes its GL resources on unmount.
5. `npm run check` clean; `npm run test:unit` green (incl. new `design` tests); `npm run test:e2e` green (incl. new persistence/specs assertions); `npm run build` succeeds.
