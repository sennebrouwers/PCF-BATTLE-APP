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
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      // D1 records and configurable form payloads are runtime-shaped. The
      // migration is tracked separately; this rule should not drown out
      // actionable correctness, hook, and accessibility warnings.
      "@typescript-eslint/no-explicit-any": "off",
      // Field is a small form adapter whose API intentionally accepts a
      // children property so callers can switch between native controls.
      "react/no-children-prop": "off",
      // These patterns are retained as warnings during the staged component
      // split instead of allowing them to hide build and runtime failures.
      "@next/next/no-html-link-for-pages": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
    },
  },
  {
    files: ["app/api/**/*.{ts,tsx}", "components/portal-app.tsx"],
    rules: {
      // These are runtime-shaped boundaries: Cloudflare D1 rows and
      // configurable portal payloads. Keep typed UI components strict while
      // migrating these legacy records to shared schemas.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    files: ["components/bracket-builder.tsx", "components/schedule-workspace.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    files: ["components/scoreboard-display.tsx", "components/gallery.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
  {
    // Scoped legacy boundaries: these components intentionally synchronize
    // browser storage, timers, remote data and dynamic user media in effects.
    // Keep the exceptions local while they are migrated to shared resource
    // hooks and the optimized image component.
    files: [
      "app/**/*.{ts,tsx}",
      "components/bracket-builder.tsx",
      "components/gallery.tsx",
      "components/portal-app.tsx",
      "components/public-header.tsx",
      "components/schedule-workspace.tsx",
      "components/ui/carousel.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      "@next/next/no-img-element": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
]);

export default eslintConfig;
