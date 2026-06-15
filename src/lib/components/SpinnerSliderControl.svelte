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
</script>

<fieldset {onmouseenter} {onmouseleave}>
  <label>
    {@render children?.()}
    <input type="range" {min} {max} {step} bind:value />
    <input type="number" {min} {max} {step} bind:value />
  </label>
</fieldset>
