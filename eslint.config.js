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

      // Style-only noise from `*.configs.all` — do not fight formatter/idiom.
      curly: "off",
      "func-style": "off",
      "sort-imports": "off",
      "sort-keys": "off",
      "unicorn/consistent-arrow-return-style": "off",
      "unicorn/single-line-block-comment-style": "off",

      // Too noisy on real object/array parameter types.
      "@typescript-eslint/prefer-readonly-parameter-types": "off",

      // CLI entry (`src/cli.ts`) needs a shebang; bin wrapper owns execution.
      "n/hashbang": "off",
      "n/shebang": "off",
    },
  },
);
