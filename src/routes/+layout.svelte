<script lang="ts">
  import Nav from "$lib/components/Nav.svelte";
  let { children } = $props();
</script>

<style>
  main {
    position: relative;
    padding: 2em;
    margin: 0 auto;
    box-sizing: border-box;
    flex: 1;
    width: 100%;
  }
</style>

<Nav />

<main>
  {@render children()}
</main>
