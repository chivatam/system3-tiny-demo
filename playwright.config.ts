import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node pi/server.ts",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: false,
    env: {
      PORT: "4318",
      FIREWORKS_API_KEY: "",
      SYSTEM3_UI_DATA: ".system3-pi/browser-tests",
    },
  },
});
