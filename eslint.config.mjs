import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      "backend/public/js/vendor/**",
      "backend/public/js/functions/communication-detail.js",
      "eslint.config.mjs",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      sourceType: "commonjs",
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  {
    files: ["backend/public/js/**/*.js", "public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        bootstrap: "readonly",
        Quill: "readonly",
      },
      sourceType: "module",
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  {
    files: ["backend/utils/supabaseClient.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "module",
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
]);
