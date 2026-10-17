import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "playwright-report", "test-results", "node_modules", "*.config.*"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Other streams are still removing `any`; keep it visible but non-blocking.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/'''/]",
          message: "Stray ''' in JSX text (pasted prompt or markdown fence). Remove it.",
        },
        {
          selector: "JSXAttribute > Literal[value=/'''/]",
          message: "Stray ''' in a JSX attribute (pasted prompt or markdown fence). Remove it.",
        },
        {
          selector: "JSXExpressionContainer TemplateElement[value.raw=/'''/]",
          message: "Stray ''' in JSX template text (pasted prompt or markdown fence). Remove it.",
        },
        {
          // "Γö" is UTF-8 box drawing decoded as CP437 (e.g. "─" shown as mojibake).
          selector: "JSXText[value=/\\u0393\\u00f6/]",
          message: "Mojibake in JSX text. Re-save the file as UTF-8 and use the intended character.",
        },
      ],
    },
  },
  {
    files: ["e2e/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
