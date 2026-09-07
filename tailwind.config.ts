import type { Config } from "tailwindcss";

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
        sans: ['Instrument Sans Variable', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Fraunces Variable', 'Georgia', 'serif'],
        mono: ['IBM Plex Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.8125rem', { lineHeight: '1rem' }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        bullish: {
          DEFAULT: "hsl(var(--bullish))",
          foreground: "hsl(var(--bullish-foreground))",
        },
        bearish: {
          DEFAULT: "hsl(var(--bearish))",
          foreground: "hsl(var(--bearish-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        'glow': '0 0 14px -6px hsl(var(--primary) / 0.42)',
        'glow-sm': '0 0 8px -5px hsl(var(--primary) / 0.36)',
        'neon-cyan': '0 0 10px rgba(0, 206, 232, 0.22)',
        'neon-green': '0 0 10px rgba(0, 214, 128, 0.2)',
        'neon-orange': '0 0 10px rgba(255, 171, 64, 0.18)',
        'card': 'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 14px 34px -24px rgba(15,23,42,0.45), 0 1px 2px rgba(15,23,42,0.07)',
        'card-hover': 'inset 0 1px 0 0 rgba(255,255,255,0.12), 0 18px 44px -26px rgba(15,23,42,0.55), 0 0 0 1px hsl(var(--primary) / 0.14)',
        'float': '0 10px 40px -10px hsl(var(--foreground) / 0.1), 0 0 0 1px hsl(var(--foreground) / 0.05)',
        'glow-lg': '0 0 22px -9px hsl(var(--primary) / 0.48)',
        'inner-glow': 'inset 0 0 18px -10px hsl(var(--primary) / 0.28)',
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
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "border-shimmer": {
          "0%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
        "neon-pulse": {
          "0%, 100%": {
            boxShadow: "0 0 10px rgba(0, 242, 254, 0.4), 0 0 20px rgba(0, 242, 254, 0.2)",
            opacity: "1",
          },
          "50%": {
            boxShadow: "0 0 15px rgba(0, 242, 254, 0.6), 0 0 30px rgba(0, 242, 254, 0.4)",
            opacity: "0.8",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "fade-in": "fade-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-up": "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        "float": "float 6s ease-in-out infinite",
        "border-shimmer": "border-shimmer 3s ease infinite",
        "neon-pulse": "neon-pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
