import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { importX } from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  // CLI already scopes to `src` via `pnpm lint`; ignore everything else as a belt.
  globalIgnores([
    "**/node_modules/**",
    "dist/**",
    "coverage/**",
    "examples/**",
    "test/**",
    "scripts/**",
    "bin/**",
  ]),
  eslint.configs.all,
  tseslint.configs.all,
  unicorn.configs.all,
  n.configs["flat/all"],
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "one-var": "off",
    },
  },
);
