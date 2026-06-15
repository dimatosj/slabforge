# slabforge — SvelteKit Modernization Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Goal

Migrate slabforge from its deprecated Sapper / Svelte 3 / Rollup / Node 14 stack onto a current, maintained foundation — SvelteKit + Svelte 5 (runes) + Vite + TypeScript on Node 20 — without changing what the tool does. This is a modernization-first pass: the geometry math and the user-facing behavior are preserved; the framework, build tooling, language, three.js usage, tests, and deploy target are all replaced.

## Decisions (locked)

| Area | Decision |
|---|---|
| Framework | Sapper → **SvelteKit** |
| Svelte | 3 → **5 (runes)** |
| Bundler | Rollup → **Vite** (via SvelteKit) |
| Language | JS → **TypeScript** |
| Node | 14 → **20 LTS** |
| three.js | bump to current; **strip from server entirely** (see §3) |
| Tests | Cypress → **Vitest (unit) + Playwright (E2E)** |
| Deploy | Heroku → **Contabo VPS** via `adapter-node` + Docker; coordinate with devops |
| Output fidelity | **Visually equivalent** — minor numerical drift acceptable, esp. from the three.js BufferGeometry rewrite |

## Migration approach

**Fresh SvelteKit scaffold, then port files in.** Scaffold a clean SvelteKit project (TS + Vitest + Playwright + `adapter-node`) and move `src/lib`, components, and routes over, adapting each. Sapper's routing and endpoint model differs enough from SvelteKit that a clean baseline is lower-risk than mutating configs in place. The original repo's commit history is retained as the starting point; per-file history continuity is not a goal given the near-total stack swap.

## Design

### 1. Route mapping (Sapper → SvelteKit)

| Old | New |
|---|---|
| `src/routes/index.svelte` | `src/routes/+page.svelte` |
| `src/routes/edit.svelte` | `src/routes/edit/+page.svelte` |
| `src/routes/_layout.svelte` | `src/routes/+layout.svelte` |
| `src/routes/_error.svelte` | `src/+error.svelte` |
| `src/routes/shape.pdf.js` | `src/routes/shape.pdf/+server.ts` |
| `src/routes/shape.stl.js` | `src/routes/shape.stl/+server.ts` |
| `src/routes/slump-mold.stl.js` | `src/routes/slump-mold.stl/+server.ts` |
| `src/components/*.svelte` | `src/lib/components/*.svelte` |
| `src/lib/shape.js` | `src/lib/shape.ts` |
| `src/{client,server,template,service-worker}.js` | replaced by SvelteKit's `app.html` + built-ins |

Download URLs (`shape.pdf?…`, `shape.stl?…`, `slump-mold.stl?…`) and their query params are unchanged, so the `edit` page's download links keep working as-is. SvelteKit permits dots in route directory names, so the `.pdf` / `.stl` segments are preserved verbatim.

### 2. The three.js problem (root cause)

The current code targets three.js ≤ r124, which still had the `Geometry` and `Face3` classes (removed in r125). Three places depend on this old API:

- `src/lib/shape.js` `calc3DGeometry()` builds a `Geometry` with `Face3` faces and vertex `Color`s.
- `src/routes/shape.stl.js` and `slump-mold.stl.js` iterate `geometry.faces` (reading `face.normal`, `face.a/.b/.c`) and `geometry.vertices[...]` to write binary STL.
- `src/components/ShapePreview3D.svelte` mutates `geometry.vertices` / `geometry.faces` in place for reactivity and renders with `MeshStandardMaterial({ vertexColors: true })`.

### 3. Decouple geometry math from three.js (key architectural change)

`calc3DGeometry()` will return a **plain, framework-agnostic triangle mesh** instead of a three.js `Geometry`:

```ts
type Vec3 = { x: number; y: number; z: number };
type Face = { a: number; b: number; c: number; normal: Vec3 };
type Mesh = { vertices: Vec3[]; faces: Face[] };
```

Face normals are computed by a small local helper (cross product of two edges, normalized) — the only piece of `Geometry.computeFaceNormals()` we actually rely on. The `RED`/vertex-color concept (used only by the bottom faces for shading in the preview) is carried as optional per-vertex or per-face color data on the mesh, consumed only by the preview.

Consequences:

- **STL endpoints** need no three.js at all — they already only iterate faces/vertices and write floats. three.js becomes a **client-only / preview-only** dependency. This removes a heavy native-ish dependency from the server bundle.
- **`ShapePreview3D.svelte`** converts the plain `Mesh` into a three.js `BufferGeometry` (a flat `Float32Array` position attribute, plus a normal attribute and a color attribute) and rebuilds it reactively when params change, rather than mutating `.vertices` / `.faces`. The highlight line geometry (`calcHighlightGeometry`) likewise returns plain points converted to a `BufferGeometry` with a position attribute.

`calcHighlightGeometry()` similarly returns plain `Vec3[]` (a 2-point line) instead of a `Geometry`.

### 4. Endpoint request/response model

Sapper endpoints use polka's `(req, res, next)` with `res.setHeader(...)` and either `res.end(buffer)` or `doc.pipe(res)`. SvelteKit `+server.ts` handlers receive a `RequestEvent` and return a `Response`:

- **STL** (`shape.stl`, `slump-mold.stl`): read query params from `event.url.searchParams`, build the `Buffer` exactly as today, return `new Response(buffer, { headers: { 'Content-Type': 'model/x.stl-binary', 'Content-Disposition': ... } })`.
- **PDF** (`shape.pdf`): pdfkit writes to a Node stream. Either (a) collect its output chunks into a `Buffer` and return that as the body, or (b) bridge `doc` into a web `ReadableStream`. Buffering is simpler and these documents are small; use buffering unless it proves problematic.
- Clean up the stray `console.log(params)` / `console.log(shape)` left in `slump-mold.stl.js`.

The `noDownload` query param behavior in `shape.pdf` is preserved.

### 5. Svelte 5 runes

`edit/+page.svelte`:
- `let sides = 4`, `height`, etc. → `$state(...)`.
- `$: shape = makeShape(...)` and `$: shapeExportQuery = ...` → `$derived(...)`.
- The two side-effecting `$:` blocks — the `sidesSelection`/`seamMode` synchronization and the units-conversion-on-change — are reactive *writes*. Convert to `$effect`, or restructure so derived values aren't written back into state where possible. The units conversion (which rewrites `height`/`bottomWidth`/etc. when the unit toggles) is genuinely effectful and stays an `$effect` guarded on a tracked previous-units value.

Components (`SpinnerSliderControl`, `RadioSelector`, `ShapePreview2D`, `ShapePreview3D`, `Nav`): `export let prop` → `let { prop } = $props()`, and event-forwarding / slots updated to Svelte 5 conventions as needed.

### 6. TypeScript

Type `shape.ts`:
- `Units = "in" | "cm" | "pt" | "px"`.
- `Prism` and `Conic` class fields and method return types; the SVG-path-returning methods return `string[]`; `calcPDFBounds` returns `{ top; bottom; left; right }`; `calc3DGeometry` returns `Mesh`.
- `makeShape(...)` signature, including the `sides === "∞"` circle branch.

Component props typed via `$props()` generics. Endpoints typed against SvelteKit's generated `RequestHandler`.

### 7. Testing

- **Vitest (unit)** on `shape.ts`: capture golden outputs from the *current* (pre-migration) code for a representative matrix of parameters — varying `sides` (3, 4, 6, ∞), `seamMode` (sides, base), differing vs. equal top/bottom widths, and units — for `calcWalls`, `calcCreaseMarkers`, `calcBevelMarkers`, `calcPDFBounds`, and the mesh (vertex/face counts + sampled coordinates). Assert the ported `shape.ts` reproduces them. This is the proof the math survived.
- **Playwright (E2E)**: load `/edit`, adjust each control, assert the 2D and 3D previews render (canvas present / SVG paths non-empty), and that the three download links return the expected `Content-Type`.

### 8. Deploy

- `adapter-node`, building a standalone Node server.
- Add a `Dockerfile` consistent with the other VPS projects; drop the Heroku `Procfile`.
- Target Node 20 LTS.
- Coordinate with the **devops** agent for the actual VPS deploy, Docker networking, and Traefik routing once the migration runs locally.

### 9. PWA / static assets

`static/` (logo, favicon, `manifest.json`, `global.css`) carries over unchanged. The Sapper service worker is dropped; if a service worker is still wanted, SvelteKit's native `src/service-worker.ts` support can be added later (out of scope for this pass — YAGNI).

## Non-goals

- No new shape types, features, or UI redesign.
- No change to the geometry algorithms beyond what the three.js decoupling requires.
- No service worker / offline support in this pass.
- No CI pipeline rework beyond what's needed to run the new tests (deploy automation coordinated separately with devops).

## Success criteria

1. `npm run dev` serves the app on a modern Node; `/` and `/edit` work.
2. The `edit` page's controls, 2D preview, and 3D preview behave as before.
3. All three downloads (PDF, STL, slump-mold STL) produce valid, equivalent files.
4. Vitest golden tests pass, proving `shape.ts` output matches the pre-migration math.
5. Playwright E2E passes.
6. `npm run build` produces a runnable `adapter-node` server; a Dockerfile builds it.
