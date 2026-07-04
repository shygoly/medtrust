import { defineConfig } from "eslint/config";

// Minimal config so `pnpm lint` succeeds; expand with @typescript-eslint when ready.
export default defineConfig([
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {},
  },
]);
