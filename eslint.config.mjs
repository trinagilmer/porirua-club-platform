import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: ["node_modules/**", "backend/public/js/vendor/**"],
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
]);
