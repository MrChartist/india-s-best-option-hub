import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/** Token helper: every colour is an HSL channel triple in src/index.css. */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        num: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        display: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        serif: ["Newsreader", "Georgia", '"Times New Roman"', "serif"],
        brand: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      // macOS text styles mapped to Inter (Body 13, Headline 13 semibold, Title 1 22).
      fontSize: {
        micro: ["10px", { lineHeight: "13px", letterSpacing: "0.01em", fontWeight: "500" }],
        label: ["11px", { lineHeight: "14px", letterSpacing: "0", fontWeight: "600" }],
        "body-sm": ["12px", { lineHeight: "16px" }],
        body: ["13px", { lineHeight: "18px" }],
        headline: ["13px", { lineHeight: "18px", fontWeight: "600" }],
        lead: ["15px", { lineHeight: "20px", fontWeight: "500" }],
        title: ["17px", { lineHeight: "22px", letterSpacing: "-0.005em", fontWeight: "600" }],
        display: ["22px", { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "700" }],
        "num-hero": ["28px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" }],
      },
      colors: {
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        foreground: token("foreground"),
        surface: token("surface"),
        window: {
          DEFAULT: token("window"),
          backdrop: token("window-backdrop"),
        },
        // Alpha is part of these tokens, so they take no <alpha-value>.
        separator: {
          DEFAULT: "hsl(var(--separator))",
          strong: "hsl(var(--separator-strong))",
        },
        selection: {
          DEFAULT: token("selection-focused"),
          foreground: token("selection-focused-foreground"),
          unfocused: "hsl(var(--selection-unfocused))",
        },
        control: {
          DEFAULT: token("control"),
          track: "hsl(var(--control-track))",
        },
        knob: token("knob"),
        // Grouped (inset) lists: System Settings-style backdrop and the rows that sit on it.
        grouped: {
          DEFAULT: token("grouped"),
          row: token("grouped-row"),
        },
        zebra: "hsl(var(--zebra))",
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
          hover: token("primary-hover"),
          ink: token("primary-ink"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        destructive: {
          DEFAULT: token("destructive"),
          foreground: token("destructive-foreground"),
        },
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
          "foreground-subtle": token("muted-foreground-subtle"),
        },
        accent: {
          DEFAULT: token("accent"),
          foreground: token("accent-foreground"),
        },
        popover: {
          DEFAULT: token("popover"),
          foreground: token("popover-foreground"),
        },
        card: {
          DEFAULT: token("card"),
          foreground: token("card-foreground"),
        },
        sidebar: {
          DEFAULT: token("sidebar-background"),
          foreground: token("sidebar-foreground"),
          accent: token("sidebar-accent"),
          "accent-foreground": token("sidebar-accent-foreground"),
          border: token("sidebar-border"),
          ring: token("sidebar-ring"),
        },
        bullish: {
          DEFAULT: token("bullish"),
          foreground: token("bullish-foreground"),
        },
        bearish: {
          DEFAULT: token("bearish"),
          foreground: token("bearish-foreground"),
        },
        warning: token("warning"),
        info: token("info"),
        product: {
          DEFAULT: token("product"),
          wash: token("wash-info"),
        },
        wash: {
          profit: token("wash-profit"),
          loss: token("wash-loss"),
          warning: token("wash-warning"),
          brand: token("wash-brand"),
          info: token("wash-info"),
          itm: token("wash-itm"),
        },
        chart: {
          call: token("chart-call"),
          put: token("chart-put"),
          1: token("chart-1"),
          2: token("chart-2"),
          3: token("chart-3"),
          4: token("chart-4"),
          5: token("chart-5"),
          "4-ink": token("chart-4-ink"),
          "5-ink": token("chart-5-ink"),
        },
      },
      // macOS radius scale: text fields 5px, push buttons and segments 6px, menus 8px, group boxes 10px, sheets 12px.
      borderRadius: {
        lg: "var(--radius)",
        md: "8px",
        sm: "5px",
        chip: "4px",
        pill: "6px",
        tab: "6px",
        tile: "10px",
        card: "10px",
        panel: "12px",
        capsule: "999px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        float: "var(--shadow-float)",
        ember: "var(--shadow-ember)",
        focus: "var(--focus-ring)",
        control: "var(--shadow-control)",
        window: "var(--shadow-window)",
      },
      transitionTimingFunction: {
        expo: "cubic-bezier(0.16, 1, 0.3, 1)",
        press: "cubic-bezier(0.25, 1, 0.5, 1)",
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        hover: "200ms",
        sheet: "280ms",
        settle: "500ms",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
