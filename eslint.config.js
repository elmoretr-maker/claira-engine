import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";

/**
 * Focused lint pass: catch undefined refs and common footguns without boiling the ocean.
 * Expand `files` over time; keep heavy/generated trees ignored.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "ui/dist/**",
      "build/**",
      "coverage/**",
      "**/.cache/**",
      "dev/fixtures/**",
      "workspace/**",
      "references/**",
      "tracking/images/**",
      "tracking/snapshots/**",
      "packs/**/reference_assets/**",
      "workflow/trainer/data/**",
      "workflow/feedback/data/**",
      "output/**",
      "temp/**",
      "Assets/**",
      "New_Arrival/**",
      "*.min.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    ignores: ["ui/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-redeclare": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["ui/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat["jsx-runtime"].rules,
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-redeclare": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
