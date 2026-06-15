import { defineConfig } from "@playwright/test";

export default defineConfig({
  webServer: {
    command: "npm run build && PORT=4173 node build",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  testDir: "e2e",
  use: { baseURL: "http://localhost:4173" },
});
