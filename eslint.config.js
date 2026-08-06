import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { importX } from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

/** import-x has no official `all` preset; enable every rule as error. */
const importXAllRules = Object.fromEntries(
  Object.keys(importX.rules).map((name) => [`import-x/${name}`, "error"]),
);

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
  {
    plugins: {
      "import-x": importX,
    },
    settings: {
      ...importX.flatConfigs.typescript.settings,
    },
    rules: {
      ...importXAllRules,
      // TypeScript-aware override from import-x's typescript preset.
      ...importX.flatConfigs.typescript.rules,
      // ESLint 10 removed FileEnumerator; keep rule intent, silence no-op warning.
      "import-x/no-unused-modules": [
        "error",
        {
          unusedExports: true,
          suppressMissingFileEnumeratorAPIWarning: true,
        },
      ],
    },
  },
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
