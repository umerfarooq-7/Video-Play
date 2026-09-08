import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The worker is plain JavaScript, so TypeScript catches nothing here and a
  // missing import only surfaces at runtime -- which for a background job
  // means a failed transcode rather than a red squiggle. no-undef is the one
  // check that would have caught it.
  {
    files: ["worker/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.nodeBuiltin },
    },
    rules: { "no-undef": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
