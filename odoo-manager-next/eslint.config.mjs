import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // Processus Electron : CommonJS exécuté par Node, hors du bundle Next.
    files: ["electron/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Préfixe « _ » : valeur écartée volontairement, par exemple lors d'une déstructuration.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      // Export statique chargé par Electron : next/image n'y optimise rien, les <img> sont voulus.
      "@next/next/no-img-element": "off",
      // Règle du React Compiler : le code existant réinitialise souvent un état dans un effet.
      // Signalée sans bloquer, en attendant la reprise de ces effets.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // En dernier : désactive les règles de mise en forme, laissées à Prettier.
  prettier,
  globalIgnores([".next/**", "out/**", "release/**", "electron/binaries/**", "next-env.d.ts"]),
]);
