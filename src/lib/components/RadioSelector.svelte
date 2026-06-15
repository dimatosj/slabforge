<script lang="ts">
  import { v4 as uuid } from "uuid";
  import type { Snippet } from "svelte";

  interface Props {
    value: unknown;
    options: unknown[];
    children?: Snippet;
  }

  let { value = $bindable(), options, children }: Props = $props();

  let effectiveOptions = $derived(
    options.map((x: unknown) => (Array.isArray(x) ? x : [x, x]))
  );

  const id = uuid();
</script>

<style>
  div {
    display: flex;
    flex-flow: row nowrap;
  }
  div input[type="radio"] {
    display: none;
  }
  div input[type="radio"] + label {
    border: 2px solid var(--black);
    flex: 1;
    text-align: center;
    padding: 0 0.5em;
    white-space: nowrap;
  }
  div input[type="radio"] + label:nth-of-type(n + 2) {
    border-left-width: 1px;
  }
  div input[type="radio"] + label:nth-last-of-type(n + 2) {
    border-right-width: 1px;
  }
  div input[type="radio"]:checked + label {
    background-color: var(--mint);
    font-weight: bold;
  }
</style>

<fieldset>
  {@render children?.()}
  <div>
    {#each effectiveOptions as item (item[0])}
      <input type="radio" bind:group={value} value={item[0]} id="{id}-{item[0]}" />
      <label for="{id}-{item[0]}">{item[1]}</label>
    {/each}
  </div>
</fieldset>
