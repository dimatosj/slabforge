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
    <a href="/slump-mold.stl?{shapeExportQuery}&moldType=hump">Download Hump Mold</a>
    <a href="/slump-mold.stl?{shapeExportQuery}&moldType=slump">Download Slump Mold</a>
  </aside>
</article>
