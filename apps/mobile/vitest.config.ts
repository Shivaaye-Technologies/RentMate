import { defineConfig } from "vitest/config";

// Unit tests for device-independent logic (no React Native runtime needed).
export default defineConfig({ test: { include: ["src/test/**/*.test.ts"], environment: "node" } });
