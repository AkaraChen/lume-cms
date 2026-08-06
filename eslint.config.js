import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { importX } from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "dist/**",
    "coverage/**",
    "node_modules/**",
    "examples/.next/**",
    "examples/node_modules/**",
    "pnpm-lock.yaml",
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
        // Lint-only project includes allowJs so n/* type-aware paths work on .mjs too.
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
