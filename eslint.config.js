import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Local design-system rules (no extra dependency).
 *  - no-faded-text: `text-muted-foreground/60` style opacity modifiers drop text below
 *    WCAG AA. Use text-muted-foreground or text-muted-foreground-subtle instead.
 *  - no-array-index-key: same intent as react/no-array-index-key (eslint-plugin-react is
 *    not installed): flags key={i} / key={index} / key={idx} and `${...i}` keys.
 */
const FADED_TEXT = /\btext-(?:muted|sidebar)-foreground\/\d+/;
const INDEX_NAME = /^(?:i|j|idx|index)$/;

const mrcPlugin = {
  rules: {
    "no-faded-text": {
      meta: {
        type: "suggestion",
        docs: { description: "Disallow opacity modifiers on muted/sidebar text tokens (contrast)." },
        schema: [],
        messages: {
          faded:
            "'{{match}}' fails WCAG AA contrast. Use text-muted-foreground or text-muted-foreground-subtle.",
        },
      },
      create(context) {
        const check = (node, value) => {
          if (typeof value !== "string") return;
          const m = value.match(FADED_TEXT);
          if (m) context.report({ node, messageId: "faded", data: { match: m[0] } });
        };
        return {
          Literal: (node) => check(node, node.value),
          TemplateElement: (node) => check(node, node.value.raw),
        };
      },
    },
    "no-array-index-key": {
      meta: {
        type: "suggestion",
        docs: { description: "Avoid array indexes as React keys." },
        schema: [],
        messages: { indexKey: "Avoid using an array index as a React key; use a stable id from the data." },
      },
      create(context) {
        return {
          "JSXAttribute[name.name='key'] > JSXExpressionContainer"(node) {
            const expr = node.expression;
            const isIndex = (e) => e && e.type === "Identifier" && INDEX_NAME.test(e.name);
            if (isIndex(expr)) context.report({ node, messageId: "indexKey" });
            else if (expr.type === "TemplateLiteral" && expr.expressions.length === 1 && expr.expressions.every(isIndex)) {
              context.report({ node, messageId: "indexKey" });
            }
          },
        };
      },
    },
  },
};

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
      mrc: mrcPlugin,
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
      // Design-system guard rails (warnings while older pages are migrated).
      "mrc/no-faded-text": "warn",
      "mrc/no-array-index-key": "warn",
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
