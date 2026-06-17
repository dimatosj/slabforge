# slabforge — Fabrication Fidelity Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

Make slabforge's physical output trustworthy and complete: guarantee the printed template's true scale (and make tiled pages alignable), finish the stubbed assembly diagram, and replace the unusable "slump mold" export with real, printable hump and slump molds — plus a manifold/winding audit so every exported STL slices cleanly.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Scope | Everything in one cycle (PDF fidelity + assembly diagram + mold rework + manifold audit) |
| Mold types | **Both**, user-selectable via a `moldType=hump\|slump` query param + two download links (no new persisted state) |
| Hump mold | Solid positive frustum of the vessel **interior**, flat base |
| Slump mold | Prismatic block with a frustum cavity of the vessel **exterior**, flat base |
| Mold STL units | mm-scaled via the existing `meshToBinarySTL` (consistent with Tier 1) |

## Scope (6 parts)

### A. PDF: true-print-scale guarantee

The PDF is only useful if printed at 100%; the near-universal "Fit to Page" default silently rescales it. Add to the instructions page (`drawInstructions` in `src/routes/shape.pdf/+server.ts`):
- A **scale-check ruler**: two short horizontal bars drawn at true scale — one exactly 1 inch (`72 pt`) and one exactly 1 cm (`28.35 pt`) — each labeled ("1 in", "1 cm") with end ticks.
- A bold instruction line: *"Print at 100% / Actual Size — do NOT 'Fit to Page'. The bars below must measure exactly 1 in and 1 cm."*
Placed in the instructions-page header block (before the step diagrams), using the document's absolute pt coordinates (not the shape's scaled space). Drawing helper: `drawScaleCheck(doc, x, y)`.

### B. PDF: page registration marks for tiling

Multi-page templates tile across sheets with no alignment aids today (only a faint gray content border + a "tape these together" instruction). In the page loop (the `for pageY / pageX` block), for each tiled page add:
- **Corner registration crosshairs** — small `+` marks at the four corners of the content rectangle (drawn just inside the margin), so overlapping/butting sheets can be aligned precisely.
- A **page label** — "R{row} · C{col}" (1-based) in a corner of the content area — so the maker knows the tiling order.
Only drawn when there is more than one page (`widthPages * heightPages > 1`). Helper: `drawRegistrationMarks(doc, contentRect, row, col)`.

### C. PDF: assembly-instructions diagram

`drawAssembleInstructions` currently writes its heading then `// TODO: assembly` with no figure, while every other step has one. Replace the stub with a before→arrow→after schematic, per `seamMode`, reusing `drawTemplate` and `drawArrow`:
- **`seamMode === "sides"`** ("Fold the walls upwards"): draw the flat creased layout small (the `shapeCreases` polygon via the existing template draw), an arrow, then a simple outline of the assembled vessel (a trapezoid silhouette: bottom width → top width over height, at the template scale).
- **`seamMode === "base"`** ("Put the wall together and attach it to the base"): draw the base outline + the wall strip small, an arrow, then the wall ring seated on the base (a simple silhouette).
These are modest line schematics for legibility, not rendered art. The function keeps its existing signature and the heading/step-divider logic; only the diagram body is added.

### D. Geometry: real molds — `src/lib/mold.ts` (new)

Two pure functions returning a watertight plain `Mesh` (`{ vertices: Vec3[]; faces: Face[] }` from `$lib/shape`), built as N-gon solids (a circle/cone uses the existing 100-side resolution constant). Both take the resolved design params and produce coordinates in design units with **outward-facing winding** and a **flat base at y = 0**.

Geometry definitions (let `n` = sides or 100 for circle; interior radii `rb`, `rt` from `bottomWidth/2`, `topWidth/2` via the apothem→circumradius convention already in `shape.ts`'s `doMath`; `t = clayThickness`; `h = height`).

**Releasability constraint (important):** a usable hump/slump mold must have no undercut, or the clay can't be removed. The mold is therefore oriented by *widest end*, independent of the vessel's own up/down orientation. Define `rWide = max(rb, rt)`, `rNarrow = min(rb, rt)`.

- **`buildHumpMold(params): Mesh`** — a solid positive frustum of the **interior**, oriented **widest-end-down** so a draped slab releases upward: a closed N-gon frustum from radius `rWide` at `y = 0` (flat base) to `rNarrow` at `y = h`, with a bottom cap (fan, downward normals), a top cap (fan, upward normals), and `n` side quads (2 triangles each, outward normals). ~`4n` triangles.
- **`buildSlumpMold(params): Mesh`** — a prismatic block with a frustum cavity of the **exterior**, oriented **mouth (widest) up** so a pressed slab releases: outer N-gon prism (outer radius = `rWide + t + margin`, `margin = t`) of total height `h + base` (`base = convertUnits(1, "cm", units)`), a flat bottom cap, a **top annular rim** connecting the outer top ring to the cavity mouth (radius `rWide + t`, at the block top), cavity walls tapering inward/down to the cavity floor (radius `rNarrow + t`, at `y = base`), and a cavity floor cap. Cavity surfaces face inward, block exterior faces outward. Watertight.

Because both molds key off `rWide`/`rNarrow`, a vessel wider at the bottom and one wider at the top both yield a releasable mold; the mold's orientation may differ from the vessel's intended orientation, which is expected and correct for the molding technique.

Both reuse the radius math but do not depend on three.js. A helper `faceNormal` already exists in `shape.ts`; `mold.ts` will compute its own normals (small local helper or import the existing pattern) so each face carries a correct outward/inward normal.

### E. STL manifold audit — `isWatertight` + winding

Add `isWatertight(mesh: Mesh): boolean` (a closed manifold has every undirected edge shared by exactly two triangles) — placed in `src/lib/stl.ts` (it pairs with serialization) or `mold.ts`. Unit tests assert:
- a hand-built closed tetrahedron → `true`; an open mesh (drop one face) → `false`;
- `buildHumpMold` and `buildSlumpMold` outputs → `true`;
- the vessel `makeShape(...).calc3DGeometry()` → `true`.

If the vessel watertightness test fails (the deep dive suspected inconsistent winding between the bottom-center fans and the walls, and the Y/Z export swap flipping orientation), fix the face winding/topology in `shape.ts`'s `calc3DGeometry` so it is watertight and outward-wound. **Bounded-risk note:** if the vessel is already watertight, this is a no-op assertion; the fix, if needed, is limited to face ordering in `calc3DGeometry` and must keep the geometry golden tests passing (face *winding* may change, but vertex positions and face *membership* do not, so golden vertex/normal comparisons use the existing tolerance — if normals flip sign, update the affected golden normals deliberately and note it).

### F. Endpoint + UI wiring

- **`src/routes/slump-mold.stl/+server.ts`**: after `parseShapeParams`, read `moldType = url.searchParams.get("moldType") ?? "hump"`; validate it is `"hump"` or `"slump"` (else 400). Build the mesh via `buildHumpMold` / `buildSlumpMold` from the validated params, serialize with `meshToBinarySTL(mesh, convertUnits(1, units, "mm"))`. Filename includes the mold type (e.g. `slabforge-…-hump-mold.stl`). The old behavior (scaling the vessel) is removed.
- **`src/routes/edit/+page.svelte`**: replace the single "Download Slump Mold" link with two: `/slump-mold.stl?{shapeExportQuery}&moldType=hump` ("Download Hump Mold") and `…&moldType=slump` ("Download Slump Mold"). No change to persisted design state (`moldType` is an export-time choice carried only on the link, like the existing pattern).

## Architecture / boundaries

- `src/lib/mold.ts` — pure mold-mesh builders (`buildHumpMold`, `buildSlumpMold`), returning `Mesh`; depends only on `shape.ts` types + math. Single responsibility: mold geometry.
- `isWatertight` lives in `src/lib/stl.ts` (manifold check alongside STL serialization), reused by tests.
- PDF helpers (`drawScaleCheck`, `drawRegistrationMarks`, assembly diagram) are added within `shape.pdf/+server.ts` alongside the existing draw helpers (the file already houses all PDF drawing; keep them together for cohesion).
- The mold endpoint and the editor links are thin wiring over `mold.ts` + the existing `meshToBinarySTL`.

## Testing

- **Unit (`src/lib/mold.test.ts`):** for both builders and representative params (prism + circle): `isWatertight` is true; the lowest vertex is at `y = 0` (flat base); hump bottom/top ring radii equal interior `rb`/`rt`; slump cavity-mouth radius equals exterior `rt + t` and outer radius equals `rt + t + margin`; face count matches the closed-solid formula.
- **Unit (`isWatertight` in `stl.test.ts`):** closed tetrahedron true; open mesh false; vessel `calc3DGeometry()` true.
- **E2E (extend `e2e/edit.test.ts`):** `GET /slump-mold.stl?…&moldType=hump` and `…&moldType=slump` both return `Content-Type: model/x.stl-binary` with > 84 bytes; an invalid `moldType` returns 400; the editor shows both "Hump Mold" and "Slump Mold" links; the PDF still returns `application/pdf` (regression check that the scale/registration/assembly additions don't break rendering).

## Out of scope

- DXF/SVG vector template export (separate item).
- Persisting `moldType` in the URL/localStorage design state (kept as a link-only export option).
- Any non-fabrication deep-dive items (mobile/touch, accessibility, width convention).
- Slicer-specific shelling of the molds (export watertight solids; the user shells via slicer infill settings).

## Success criteria

1. The PDF instructions page shows a true-scale 1 in / 1 cm ruler and a "print at 100%" warning; multi-page templates have corner registration marks + page labels.
2. The assembly step shows a real before→after diagram for both seam modes (no blank stub).
3. `GET /slump-mold.stl?…&moldType=hump` downloads a watertight solid positive frustum; `…&moldType=slump` downloads a watertight block-with-cavity; both are mm-scaled; invalid `moldType` → 400. The editor offers both as links.
4. `isWatertight` passes for both molds and the vessel mesh (vessel winding fixed if needed, with golden tests still green).
5. `npm run check` clean; `npm run test:unit` green (incl. `mold` + `isWatertight` tests); `npm run test:e2e` green (incl. the two mold links + PDF regression); `npm run build` succeeds.
