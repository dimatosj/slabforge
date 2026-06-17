# Editor State / "Make It a Real Tool" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the slabforge design in the URL (+ localStorage), surface fabrication numbers in the editor, make unit toggling lossless, and fix three 3D-preview defects.

**Architecture:** A new pure `$lib/design.ts` (defaults, serialize/parse, lenient load, conversion + page-count helpers) reusing the existing strict `parseShapeParams`; a client-only `edit/+page.ts` (`ssr=false`) whose `load` resolves URL→localStorage→defaults; `edit/+page.svelte` initializes from that data and persists changes via a debounced `replaceState` + localStorage effect; and targeted fixes to `ShapePreview3D.svelte`.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript, Vitest, Playwright, three.js. Work from `/Users/jsd/projects/slabforge`.

**Spec:** `docs/superpowers/specs/2026-06-17-editor-state-design.md`

**Working branch:** create `git checkout -b editor-state` before Task 1.

---

## File Structure

- **Create** `src/lib/design.ts` — editor design-state utilities (defaults, (de)serialization, lenient `loadDesign`, `convertValue`, `estimatePageCount`).
- **Create** `src/lib/design.test.ts` — unit tests.
- **Create** `src/routes/edit/+page.ts` — `ssr=false` + `load` returning the initial design.
- **Modify** `src/routes/edit/+page.svelte` — init from `data`, persist effect, lossless units, specs panel.
- **Modify** `src/lib/components/ShapePreview3D.svelte` — aspect/resize/dispose fixes.
- **Modify** `e2e/edit.test.ts` — persistence/hydration/specs/resize assertions.

---

## Task 1: `src/lib/design.ts` + tests

**Files:**
- Create: `src/lib/design.ts`
- Create: `src/lib/design.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/design.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import makeShape from "./shape";
import {
  DEFAULT_PARAMS,
  serializeDesign,
  parseDesignQuery,
  convertValue,
  estimatePageCount,
} from "./design";

describe("serializeDesign / parseDesignQuery", () => {
  it("round-trips a design", () => {
    const p = { ...DEFAULT_PARAMS, sides: 6, units: "cm", seamMode: "base", pageSize: "auto" } as const;
    expect(parseDesignQuery(serializeDesign(p))).toEqual(p);
  });
  it("round-trips the infinity sides token", () => {
    const p = { ...DEFAULT_PARAMS, sides: "∞", seamMode: "base" } as const;
    expect(parseDesignQuery(serializeDesign(p))).toEqual(p);
  });
  it("returns null for an invalid query", () => {
    expect(
      parseDesignQuery("sides=2&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in")
    ).toBeNull();
  });
  it("returns null for an empty query", () => {
    expect(parseDesignQuery("")).toBeNull();
  });
});

describe("convertValue", () => {
  it("round-trips clay thickness in->cm->in without drift", () => {
    expect(convertValue(convertValue(0.25, "in", "cm"), "cm", "in")).toBe(0.25);
  });
  it("round-trips 5 in", () => {
    expect(convertValue(convertValue(5, "in", "cm"), "cm", "in")).toBe(5);
  });
});

describe("estimatePageCount", () => {
  it("auto is always one page", () => {
    const shape = makeShape(4, 5, 5, 5, 0.25, "sides", "in");
    expect(estimatePageCount(shape, "in", "auto")).toBe(1);
  });
  it("returns a positive integer for letter", () => {
    const shape = makeShape(4, 5, 5, 5, 0.25, "sides", "in");
    const n = estimatePageCount(shape, "in", "letter");
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });
  it("a large shape needs more than one letter page", () => {
    const shape = makeShape(4, 40, 40, 40, 0.5, "sides", "in");
    expect(estimatePageCount(shape, "in", "letter")).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './design'`.

- [ ] **Step 3: Implement `src/lib/design.ts`**

```ts
import round from "lodash/round";
import { convertUnits, type Units, type Shape } from "./shape";
import { parseShapeParams, type ShapeParams } from "./shapeParams";

export const LS_KEY = "slabforge:lastDesign";

export const DEFAULT_PARAMS: ShapeParams = {
  sides: 4,
  height: 5,
  bottomWidth: 5,
  topWidth: 5,
  clayThickness: 0.25,
  seamMode: "sides",
  units: "in",
  pageSize: "letter",
};

// The single canonical serializer; the editor's export query and download links
// both route through this so the URL, localStorage, and downloads stay in sync.
export function serializeDesign(p: ShapeParams): string {
  return new URLSearchParams({
    sides: String(p.sides),
    height: String(p.height),
    bottomWidth: String(p.bottomWidth),
    topWidth: String(p.topWidth),
    clayThickness: String(p.clayThickness),
    seamMode: p.seamMode,
    units: p.units,
    pageSize: p.pageSize,
  }).toString();
}

// Lenient wrapper around the strict endpoint parser: null instead of throwing.
export function parseDesignQuery(qs: string): ShapeParams | null {
  try {
    return parseShapeParams(new URLSearchParams(qs));
  } catch {
    return null;
  }
}

// Resolve the initial design: URL params, then localStorage, then defaults.
// Reads localStorage, so it must run client-side only (the /edit route is ssr=false).
export function loadDesign(url: URL): ShapeParams {
  if (url.searchParams.has("sides")) {
    try {
      return parseShapeParams(url.searchParams);
    } catch {
      // fall through to localStorage / defaults
    }
  }
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const parsed = parseDesignQuery(saved);
      if (parsed) return parsed;
    }
  } catch {
    // localStorage unavailable; ignore
  }
  return { ...DEFAULT_PARAMS };
}

// Unit conversion rounded to enough precision that in<->cm round-trips are stable.
export function convertValue(q: number, from: Units, to: Units): number {
  return round(convertUnits(q, from, to), 4);
}

// US Letter is 612x792 pt; the PDF endpoint uses PDFDocument({ margin: 36 }),
// leaving 540x720 pt of content per page.
const LETTER_CONTENT_WIDTH_PT = 540;
const LETTER_CONTENT_HEIGHT_PT = 720;

export function estimatePageCount(shape: Shape, units: Units, pageSize: string): number {
  if (pageSize === "auto") return 1;
  const scale = convertUnits(1, units, "pt");
  const b = shape.calcPDFBounds();
  const minWidth = (b.right - b.left) * scale;
  const minHeight = (b.bottom - b.top) * scale;
  return Math.ceil(minWidth / LETTER_CONTENT_WIDTH_PT) * Math.ceil(minHeight / LETTER_CONTENT_HEIGHT_PT);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit`
Expected: PASS — the new `design` tests green plus all existing tests.

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: 0 errors. (`Shape = ReturnType<typeof makeShape>` is already exported from `shape.ts`; both `Prism` and `Conic` have `calcPDFBounds`, so `shape.calcPDFBounds()` is valid on the union.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/design.ts src/lib/design.test.ts
git commit -m "feat: add editor design-state utilities (serialize/load/convert/page-count)"
```

---

## Task 2: Wire the editor to persistent state + specs panel + lossless units

**Files:**
- Create: `src/routes/edit/+page.ts`
- Modify: `src/routes/edit/+page.svelte` (full replacement below)

- [ ] **Step 1: Create `src/routes/edit/+page.ts`**

```ts
import { loadDesign } from "$lib/design";
import type { PageLoad } from "./$types";

// The editor is a fully interactive WebGL/canvas app; render it client-side only
// so `load` can read the URL AND localStorage in one place with no hydration mismatch.
export const ssr = false;

export const load: PageLoad = ({ url }) => {
  return { design: loadDesign(url) };
};
```

- [ ] **Step 2: Replace `src/routes/edit/+page.svelte` entirely**

```svelte
<script lang="ts">
  import makeShape, { type Units, type Shape } from "$lib/shape";
  import { serializeDesign, convertValue, estimatePageCount, LS_KEY } from "$lib/design";
  import { replaceState } from "$app/navigation";
  import type { PageData } from "./$types";
  import SpinnerSliderControl from "$lib/components/SpinnerSliderControl.svelte";
  import ShapePreview2D from "$lib/components/ShapePreview2D.svelte";
  import ShapePreview3D from "$lib/components/ShapePreview3D.svelte";
  import RadioSelector from "$lib/components/RadioSelector.svelte";

  let { data }: { data: PageData } = $props();

  let sidesSelection = $state(data.design.sides === "∞" ? "circle" : "prism");
  let sides: number | "∞" = $state(data.design.sides);
  let height = $state(data.design.height);
  let bottomWidth = $state(data.design.bottomWidth);
  let topWidth = $state(data.design.topWidth);
  let clayThickness = $state(data.design.clayThickness);
  let seamMode = $state(data.design.seamMode);
  let units: Units = $state(data.design.units);
  let pageSize = $state(data.design.pageSize);
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

  let shape: Shape = $derived(
    makeShape(sides, height, bottomWidth, topWidth, clayThickness, seamMode, units)
  );

  let shapeExportQuery = $derived(
    serializeDesign({ sides, height, bottomWidth, topWidth, clayThickness, seamMode, units, pageSize })
  );

  // Persist to the URL (shareable) + localStorage (reload-survival), debounced so
  // slider drags don't thrash. replaceState (not pushState) keeps history clean.
  let persistTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const query = shapeExportQuery;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      replaceState(`?${query}`, {});
      try {
        localStorage.setItem(LS_KEY, query);
      } catch {
        // localStorage unavailable; ignore
      }
    }, 200);
    return () => clearTimeout(persistTimer);
  });

  let oldUnits: Units = units;
  $effect(() => {
    if (units !== oldUnits) {
      const fix = (q: number) => convertValue(q, oldUnits, units);
      height = fix(height);
      bottomWidth = fix(bottomWidth);
      topWidth = fix(topWidth);
      clayThickness = fix(clayThickness);
      oldUnits = units;
    }
  });

  let bevelAngle = $derived(shape.bevelAngleDegrees ?? 45);
  let wallLength = $derived(shape.doMath().wallLength);
  let pageCount = $derived(estimatePageCount(shape, units, pageSize));
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
  .specs {
    margin: 1rem 0;
    font-size: 0.9em;
  }
  .specs div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    white-space: nowrap;
  }
  .specs dt {
    color: var(--brown, #555);
  }
  .specs dd {
    margin: 0;
    font-weight: 600;
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
    <dl class="specs">
      <div><dt>Bevel angle</dt><dd>{bevelAngle}°</dd></div>
      <div><dt>Wall length</dt><dd>{wallLength.toFixed(2)} {units}</dd></div>
      <div>
        <dt>Prints on</dt>
        <dd>
          {#if pageSize === "auto"}1 page (auto-sized){:else}{pageCount} Letter page{pageCount === 1 ? "" : "s"}{/if}
        </dd>
      </div>
    </dl>
    <a href="/shape.pdf?{shapeExportQuery}">Download PDF</a>
    <a href="/shape.stl?{shapeExportQuery}">Download STL</a>
    <a href="/slump-mold.stl?{shapeExportQuery}">Download Slump Mold</a>
  </aside>
</article>
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: 0 errors in `edit/+page.svelte` and `edit/+page.ts`.

- [ ] **Step 4: Verify persistence + specs at runtime (production build + Playwright)**

```bash
npm run build && (PORT=3300 node build & echo $! > /tmp/sf.pid) && sleep 2
cat > /Users/jsd/projects/slabforge/_state.mjs <<'EOF'
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
// 1. URL hydration
await p.goto('http://localhost:3300/edit?sides=6&height=6&bottomWidth=4&topWidth=7&clayThickness=0.3&seamMode=base&units=cm&pageSize=letter', { waitUntil: 'networkidle' });
const sidesVal = await p.locator('fieldset', { hasText: 'Sides' }).locator('input[type=number]').inputValue();
console.log('sides from URL ->', sidesVal);
// 2. specs panel
console.log('specs visible ->', await p.getByText(/Bevel angle/i).isVisible());
// 3. persistence: change height, wait debounce, reload bare
const h = p.locator('fieldset', { hasText: 'Height' }).locator('input[type=number]');
await h.fill('12'); await h.blur(); await p.waitForTimeout(500);
const urlAfter = new URL(p.url()).searchParams.get('height');
console.log('url height after edit ->', urlAfter);
await p.goto('http://localhost:3300/edit', { waitUntil: 'networkidle' });
console.log('height after bare reload ->', await p.locator('fieldset', { hasText: 'Height' }).locator('input[type=number]').inputValue());
await b.close();
EOF
node _state.mjs; rm -f _state.mjs
kill $(cat /tmp/sf.pid)
```
Expected: `sides from URL -> 6`; `specs visible -> true`; `url height after edit -> 12` (replaceState wrote it); `height after bare reload -> 12` (localStorage restore). If port 3300 is busy, pick another and adjust. Report the four printed values.

- [ ] **Step 5: Commit**

```bash
git add src/routes/edit/+page.ts src/routes/edit/+page.svelte
git commit -m "feat: persist editor design to URL + localStorage, add specs panel, lossless units"
```

---

## Task 3: 3D-preview robustness (`ShapePreview3D.svelte`)

**Files:**
- Modify: `src/lib/components/ShapePreview3D.svelte`

- [ ] **Step 1: Fix `peekDimensions`**

Find the current function:
```ts
  function peekDimensions() {
    canvas.width = 0;
    canvas.height = 0;
    canvas.setAttribute("style", "");
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.width / canvas.height;
    camera.updateProjectionMatrix();
  }
```
Replace it with (guard before mount; measure client size into locals; derive aspect from those, not the just-zeroed `canvas.width/height`):
```ts
  function peekDimensions() {
    if (!renderer || !camera) return;
    canvas.width = 0;
    canvas.height = 0;
    canvas.setAttribute("style", "");
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = h === 0 ? 1 : w / h;
    camera.updateProjectionMatrix();
  }
```

- [ ] **Step 2: Add a window-resize listener**

In the markup, immediately before `<article>`, add:
```svelte
<svelte:window onresize={peekDimensions} />
```

- [ ] **Step 3: Dispose GL resources on unmount**

In `onMount`, the current cleanup is:
```ts
    return () => cancelAnimationFrame(frame);
```
Replace it with (these locals — `controls`, `meshMaterial`, `lineMaterial`, and the outer `mesh`/`lines`/`renderer` — are all in scope of this closure):
```ts
    return () => {
      cancelAnimationFrame(frame);
      controls.dispose();
      meshMaterial.dispose();
      lineMaterial.dispose();
      mesh.geometry.dispose();
      lines.geometry.dispose();
      renderer.dispose();
    };
```

- [ ] **Step 4: Type-check + build**

Run: `npm run check`
Expected: 0 errors (the pre-existing `state_referenced_locally` warnings in this file are unchanged and acceptable).
Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Verify resize at runtime (production build + Playwright)**

```bash
npm run build && (PORT=3300 node build & echo $! > /tmp/sf.pid) && sleep 2
cat > /Users/jsd/projects/slabforge/_resize.mjs <<'EOF'
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:3300/edit', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
console.log('canvas visible before ->', await p.locator('canvas').isVisible());
await p.setViewportSize({ width: 700, height: 600 });
await p.waitForTimeout(500);
console.log('canvas visible after resize ->', await p.locator('canvas').isVisible());
console.log('page errors ->', errs.length ? errs : 'none');
await b.close();
EOF
node _resize.mjs; rm -f _resize.mjs
kill $(cat /tmp/sf.pid)
```
Expected: `canvas visible before -> true`, `canvas visible after resize -> true`, `page errors -> none`. Report the values.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/ShapePreview3D.svelte
git commit -m "fix: 3D preview aspect/resize handling and GL resource disposal"
```

---

## Task 4: Extend the Playwright E2E suite

**Files:**
- Modify: `e2e/edit.test.ts`

- [ ] **Step 1: Add the new tests**

Append these tests to `e2e/edit.test.ts` (keep the existing four). They rely on Playwright's default per-test context isolation, so localStorage does not leak between tests.

```ts
test("hydrates editor state from URL params", async ({ page }) => {
  await page.goto(
    "/edit?sides=6&height=6&bottomWidth=4&topWidth=7&clayThickness=0.3&seamMode=base&units=cm&pageSize=letter"
  );
  const sides = page.locator("fieldset", { hasText: "Sides" }).locator('input[type=number]');
  await expect(sides).toHaveValue("6");
});

test("persists the design across a reload (localStorage)", async ({ page }) => {
  await page.goto("/edit");
  const height = page.locator("fieldset", { hasText: "Height" }).locator('input[type=number]');
  await height.fill("12");
  await height.blur();
  await page.waitForTimeout(500); // debounced persist
  await page.goto("/edit"); // bare reload -> should restore from localStorage
  await expect(
    page.locator("fieldset", { hasText: "Height" }).locator('input[type=number]')
  ).toHaveValue("12");
});

test("shows the specs panel", async ({ page }) => {
  await page.goto("/edit");
  await expect(page.getByText(/Bevel angle/i)).toBeVisible();
  await expect(page.getByText(/Wall length/i)).toBeVisible();
});

test("3D canvas survives a viewport resize", async ({ page }) => {
  await page.goto("/edit");
  await expect(page.locator("canvas")).toBeVisible();
  await page.setViewportSize({ width: 700, height: 600 });
  await page.waitForTimeout(300);
  await expect(page.locator("canvas")).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e`
Expected: all tests pass (the original 4 + these 4 = 8). It auto-builds and runs `node build`.

- [ ] **Step 3: Commit**

```bash
git add e2e/edit.test.ts
git commit -m "test: e2e for editor state persistence, specs panel, and 3D resize"
```

---

## Final verification (after all tasks)

- [ ] `npm run check` → 0 errors.
- [ ] `npm run test:unit` → all green (existing + new `design` tests).
- [ ] `npm run test:e2e` → 8/8.
- [ ] `npm run build` → succeeds.

---

## Self-Review Notes

- **Spec coverage:** Part 1 (persistence) → Tasks 1 (`design.ts`) + 2 (`+page.ts`, persist effect). Part 2 (specs panel) → Task 1 (`estimatePageCount`) + 2 (markup/derived). Part 3 (lossless units) → Task 1 (`convertValue`) + 2 (units effect). Part 4 (3D robustness) → Task 3. Testing → Tasks 1 (unit) + 4 (e2e).
- **`ssr=false`** is set only on `edit/+page.ts`; the home route is untouched and keeps SSR.
- **Name consistency:** `serializeDesign`, `parseDesignQuery`, `loadDesign`, `convertValue`, `estimatePageCount`, `DEFAULT_PARAMS`, `LS_KEY` are defined in Task 1 and consumed with matching signatures in Task 2. `shapeExportQuery` now flows through `serializeDesign`, keeping the download links and the persisted URL identical.
- **No golden/geometry impact:** none of these tasks touch `shape.ts` geometry or the export endpoints, so the geometry golden fixtures are unaffected.
- **Behavior preserved:** the sides/seam sync effect and the controls/markup are unchanged except for the added specs panel and the `serializeDesign`/`convertValue` swaps.
