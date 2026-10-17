import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/** Token helper: every colour is an HSL channel triple in src/index.css. */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        num: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.8125rem", { lineHeight: "1rem" }],
        micro: ["10px", { lineHeight: "1.1", letterSpacing: "0.08em", fontWeight: "650" }],
        label: ["11px", { lineHeight: "1.1", letterSpacing: "0.07em", fontWeight: "650" }],
        "body-sm": ["12.5px", { lineHeight: "1.5" }],
        body: ["13px", { lineHeight: "1.5" }],
        lead: ["14px", { lineHeight: "1.5", fontWeight: "500" }],
        title: ["20px", { lineHeight: "1.16", letterSpacing: "-0.02em", fontWeight: "700" }],
        display: ["28px", { lineHeight: "1.1", letterSpacing: "-0.03em", fontWeight: "800" }],
        "num-hero": ["34px", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      colors: {
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        foreground: token("foreground"),
        surface: {
          DEFAULT: token("surface"),
          foreground: token("surface-foreground"),
        },
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
          primary: token("sidebar-primary"),
          "primary-foreground": token("sidebar-primary-foreground"),
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
        warning: {
          DEFAULT: token("warning"),
          foreground: token("warning-foreground"),
        },
        info: {
          DEFAULT: token("info"),
          foreground: token("info-foreground"),
        },
        product: {
          DEFAULT: token("product"),
          foreground: token("product-foreground"),
          wash: token("wash-info"),
          ink: token("product-ink"),
        },
        wash: {
          profit: token("wash-profit"),
          loss: token("wash-loss"),
          warning: token("wash-warning"),
          brand: token("wash-brand"),
          info: token("wash-info"),
        },
        sentiment: {
          1: token("sentiment-1"),
          2: token("sentiment-2"),
          3: token("sentiment-3"),
          4: token("sentiment-4"),
          5: token("sentiment-5"),
        },
        chart: {
          grid: token("chart-grid"),
          axis: token("chart-axis"),
          call: token("chart-call"),
          put: token("chart-put"),
          fii: token("chart-fii"),
          1: token("chart-1"),
          2: token("chart-2"),
          3: token("chart-3"),
          4: token("chart-4"),
          5: token("chart-5"),
          6: token("chart-6"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "10px",
        sm: "8px",
        chip: "6px",
        pill: "7px",
        tab: "8px",
        tile: "10px",
        card: "14px",
        panel: "24px",
        capsule: "999px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        float: "var(--shadow-float)",
        ember: "var(--shadow-ember)",
        // Legacy aliases: the old neon glows now resolve to the calm card shadow.
        glow: "var(--shadow-card)",
        "glow-sm": "var(--shadow-card)",
        "glow-lg": "var(--shadow-card)",
      },
      transitionTimingFunction: {
        expo: "cubic-bezier(0.16, 1, 0.3, 1)",
        press: "cubic-bezier(0.25, 1, 0.5, 1)",
        spring: "cubic-bezier(0.3, 1.4, 0.5, 1)",
        overlay: "cubic-bezier(0.32, 0.72, 0, 1)",
        move: "cubic-bezier(0.65, 0, 0.35, 1)",
      },
      transitionDuration: {
        press: "120ms",
        fast: "150ms",
        hover: "250ms",
        page: "320ms",
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
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-up": "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
