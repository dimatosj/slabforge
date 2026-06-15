<script lang="ts">
  let {
    value = $bindable(),
    min = undefined,
    max = undefined,
    step = undefined,
    onmouseenter = undefined,
    onmouseleave = undefined,
    children,
  } = $props();
</script>

<fieldset {onmouseenter} {onmouseleave}>
  <label>
    {@render children?.()}
    <input type="range" {min} {max} {step} bind:value />
    <input type="number" {min} {max} {step} bind:value />
  </label>
</fieldset>
