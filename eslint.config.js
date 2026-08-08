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

      // Case-by-case: keep unicorn/name-replacements; drop the rest (KIT-649).
      "id-length": "off",
      "no-continue": "off",
      "no-ternary": "off",
      "no-undefined": "off",
      "no-void": "off",
      "unicorn/no-null": "off",

      // Arbitrary size caps; function length is a review concern, not a gate.
      complexity: "off",
      "max-classes-per-file": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "@typescript-eslint/max-params": "off",
      "unicorn/max-nested-calls": "off",
      "unicorn/try-complexity": "off",

      // TS inference covers these; annotating every callback is churn.
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/member-ordering": "off",
      "@typescript-eslint/parameter-properties": "off",

      // Flags 0/1/-1 array indexing and slice offsets; no threshold avoids that.
      "@typescript-eslint/no-magic-numbers": "off",

      // Compile/watch pipelines await sequentially on purpose (ordering, cache).
      "no-await-in-loop": "off",

      // Idiom preferences from `.all` that fight readable existing patterns.
      "no-plusplus": "off",
      "no-underscore-dangle": "off",
      "@typescript-eslint/prefer-destructuring": "off",
      "unicorn/no-array-callback-reference": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/no-await-expression-member": "off",
      "unicorn/no-break-in-nested-loop": "off",
      "unicorn/no-unreadable-new-expression": "off",
      "unicorn/prefer-simple-condition-first": "off",

      // Not shipped in our support range: Temporal (no stable Node),
      // Iterator.concat (proposal), Set#difference (Node >=22) and
      // Error.isError (Node >=24) — we support Node >=20.
      "unicorn/prefer-temporal": "off",
      "unicorn/prefer-iterator-concat": "off",
      "unicorn/prefer-set-methods": "off",
      "unicorn/prefer-error-is-error": "off",

      // Conflicts with @typescript-eslint/consistent-return, which requires an
      // explicit `return undefined` in mixed-return functions.
      "unicorn/no-useless-undefined": "off",

      // Multi-line comment paragraphs: only the first line must be capitalized.
      "capitalized-comments": [
        "error",
        "always",
        { ignoreConsecutiveComments: true },
      ],

      // We sort string arrays; default lexicographic order is the intent.
      "unicorn/require-array-sort-compare": "off",

      // Generic factory/mapped-type code needs assertions; the `no-unsafe-*`
      // any-tracking rules stay on to catch actual `any` leaks.
      "@typescript-eslint/no-unsafe-type-assertion": "off",

      // Records keyed by user data; `delete` is the point.
      "@typescript-eslint/no-dynamic-delete": "off",

      // `x != null` deliberately covers undefined too.
      "no-eq-null": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],

      // Truthiness on nullable strings/booleans is idiomatic and intended here;
      // still errors on numbers, `any`, and other surprising operands.
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowNullableBoolean: true,
          allowNullableString: true,
          allowString: true,
        },
      ],

      // `_`-prefixed bindings and rest-sibling destructuring mark deliberate omissions.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],

      // Empty catch = best-effort probe (e.g. optional file reads).
      "no-empty": ["error", { allowEmptyCatch: true }],

      // MDX component factories are PascalCase by convention.
      camelcase: "off",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          format: ["camelCase", "PascalCase"],
          selector: "function",
        },
      ],

      // Old callback-style rule; false-positives on params that happen to be functions.
      "n/callback-return": "off",

      // A `default` case is a deliberate exhaustiveness decision.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  // CLI is the stdout/stderr surface; keep no-console elsewhere.
  {
    files: ["src/cli.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
