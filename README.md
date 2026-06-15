# slabforge

A computer-aided design tool for slab built ceramics.

## Technical Notes

Built with [SvelteKit](https://svelte.dev/docs/kit) (Svelte 5) + [Vite](https://vite.dev) + TypeScript. The 3D preview is rendered with [three.js](https://threejs.org), and PDF template export is generated with [pdfkit](https://pdfkit.org).

### Development

```bash
npm install
npm run dev
```

This starts the Vite dev server, available by default at [localhost:5173](http://localhost:5173).

### Type-checking

```bash
npm run check
```

### Tests

```bash
npm run test:unit   # Vitest (geometry golden tests)
npm run test:e2e    # Playwright (end-to-end)
```

### Production

```bash
npm run build
node build
```

`npm run build` uses `@sveltejs/adapter-node` to produce a standalone Node server in `build/`. Run it with `node build`; it honors the `PORT` environment variable (default `3000`).

A [`Dockerfile`](./Dockerfile) is included for containerized deployment.
