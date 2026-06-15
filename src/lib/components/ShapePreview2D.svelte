<script lang="ts">
  import { onMount } from "svelte";
  import { convertUnits, type Units, type Shape } from "$lib/shape";

  interface Props {
    shape: Shape;
  }

  let { shape }: Props = $props();

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

<svelte:window onresize={peekSVGDimensions} />

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
