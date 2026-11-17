// eslint.config.js

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
// import prettier from "eslint-config-prettier";

export default tseslint.config(
  // global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.vite/**",
      "**/.turbo/**",
      "**/ui/**",
      "**/scripts/**",
      "**/*.min.js",
      "**/*.d.ts"
    ]
  },

  // JavaScript base
  {
    ...js.configs.recommended,
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser
    }
  },

  // TypeScript + React
  {
    files: ["**/*.{ts,tsx}"],

    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended
    ],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser
    },

    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },

    rules: {
      // React Hooks
      ...reactHooks.configs.recommended.rules,

      // React Refresh
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true
        }
      ],

      // TypeScript
      "@typescript-eslint/no-explicit-any": "error",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true
        }
      ],

      // JavaScript
      "no-undef": "off"
    }
  }
);