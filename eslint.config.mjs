import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The owner connection bypasses RLS. Only the webhook cron (which must read
  // every tenant's deliveries) and offline scripts may hold it; everything else
  // goes through userDb()/anonDb() in lib/db/index.ts.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/db/**", "scripts/**", "app/api/cron/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "pg", message: "Query through userDb()/anonDb() from @/lib/db so RLS applies." },
            { name: "@/lib/db/pool", message: "Query through userDb()/anonDb() from @/lib/db so RLS applies." },
            { name: "@/lib/db/system", message: "The owner connection bypasses RLS; only the webhook cron may use it." },
          ],
        },
      ],
    },
  },
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
    // Skills installed by `vercel integration add`; not project source.
    ".agents/**",
  ]),
]);

export default eslintConfig;
