// ESLint flat config. `.mjs` on purpose: the root package.json must NOT get
// "type": "module" — that breaks the CommonJS /api functions on Vercel
// (see HANDOFF.md §7).
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "data/", "scripts/"] },

  js.configs.recommended,

  // Shared rules for everything.
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // Browser scripts, loaded as plain <script> tags (no bundler, no modules).
  {
    files: ["app.js", "login.js", "supabaseClient.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        supabase: "readonly", // UMD global from the supabase-js CDN script
      },
    },
  },

  // Vercel serverless functions (CommonJS on Node).
  {
    files: ["api/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },

  // Tests and tooling config (ES modules on Node, tests run in jsdom).
  {
    files: ["tests/**/*.js", "*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
