import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Two test projects:
 *  - "lib":  pure logic under src/lib/** runs in plain Node (fast, no DOM).
 *  - "dom":  everything else (hooks, components, src/test/**) runs in jsdom.
 *  - "server": proxy-side modules under server/** (plain Node, .mjs tests).
 *
 * A src/lib test that genuinely needs the DOM (localStorage, CSS variables)
 * goes in DOM_LIB_TESTS below, or starts with a `// @vitest-environment jsdom`
 * docblock.
 */
const DOM_LIB_TESTS = ["src/lib/chartTheme.test.ts", "src/lib/options/__tests__/contract.test.ts"];

const alias = { "@": path.resolve(__dirname, "./src") };

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "lib",
          environment: "node",
          include: ["src/lib/**/*.{test,spec}.{ts,tsx}"],
          exclude: DOM_LIB_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          // Full-page render tests (Flow, Expiry Day, Optimizer) take 2-4 s alone and
          // exceed the 5 s default under coverage instrumentation on shared CI runners.
          testTimeout: 20_000,
          include: ["src/*.{test,spec}.{ts,tsx}", "src/!(lib)/**/*.{test,spec}.{ts,tsx}", ...DOM_LIB_TESTS],
        },
      },
      {
        extends: true,
        test: {
          // Proxy-side modules (risk engine, panic layer, basket engine, broker adapters).
          name: "server",
          environment: "node",
          include: ["server/**/*.{test,spec}.mjs"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/__tests__/**",
        "src/test/**",
        "src/components/ui/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        // Hard gate: the pricing core must stay well tested.
        "src/lib/options/**": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        // Global ratchet. Measured 2026-10-17 (round 2): statements/lines 74.2%,
        // branches 74.2%, functions 69.1%. Raise these as coverage grows; never lower
        // them to make a change pass.
        statements: 70,
        branches: 60,
        functions: 65,
        lines: 70,
      },
    },
  },
});
