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
    const el = event.currentTarget as HTMLInputElement;
    const lo = min === undefined ? -Infinity : Number(min);
    const hi = max === undefined ? Infinity : Number(max);
    let n = parseFloat(el.value);
    if (!Number.isFinite(n)) {
      n = Number.isFinite(lo) ? lo : 0;
    } else {
      n = Math.min(hi, Math.max(lo, n));
    }
    // Set both the reactive state and the DOM value imperatively so that the
    // input reflects the clamped number even when Svelte's microtask batching
    // hasn't flushed yet (e.g. on the same blur tick that triggered this event).
    value = n;
    el.value = String(n);
  }
</script>

<fieldset {onmouseenter} {onmouseleave}>
  <label>
    {@render children?.()}
    <input type="range" {min} {max} {step} bind:value />
    <input type="number" {min} {max} {step} bind:value onchange={clampOnChange} />
  </label>
</fieldset>
