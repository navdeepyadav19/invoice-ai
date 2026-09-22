import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch files written by the Remember plugin, not project source.
    ".remember/**",
    // Agent worktrees: full repo copies (with their own .next builds) that
    // would otherwise be linted as if they were this project's source.
    ".claude/**",
    // Workspace packages: build output and code generated from the OpenAPI spec.
    "packages/*/dist/**",
    "packages/*/src/generated/**",
  ]),
]);

export default eslintConfig;
