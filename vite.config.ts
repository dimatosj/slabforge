import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // Pre-bundle three.js up front so the dev server doesn't lazily re-optimize
  // (and force a reload) the first time the 3D preview imports it.
  optimizeDeps: {
    include: ["three", "three/examples/jsm/controls/OrbitControls.js"],
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
});
