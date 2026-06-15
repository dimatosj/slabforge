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
