# Contributing to India's Best Option Hub

First off, thank you for considering contributing! 🎉 This is an open-source community project and every contribution matters — whether it's fixing a typo, adding a feature, or improving documentation.

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [How to Contribute](#how-to-contribute)
- [Coding Guidelines](#coding-guidelines)
- [Pull Request Process](#pull-request-process)

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/india-s-best-option-hub.git
   cd india-s-best-option-hub
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Start development:**
   ```bash
   npm run dev
   ```
5. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Prerequisites
- Node.js v18+
- npm v9+

### Environment Variables (Optional)
```bash
cp .env.example .env
# Add your Dhan API credentials if you have them
```

### Scripts
| Command | Purpose |
|---------|---------|
| `npm run dev` | Start frontend + proxy server |
| `npm run dev:vite` | Start frontend only |
| `npm run proxy` | Start proxy server only |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests |

## Project Architecture

```
src/
├── pages/          → Route-level components (one per page)
├── components/     → Reusable UI components
│   ├── ui/         → Base shadcn/ui components
│   └── dashboard/  → Dashboard-specific widgets
├── hooks/          → React hooks (data fetching, state)
├── lib/            → Utility functions the core logic
```

### Key Files to Understand

| File | What It Does |
|------|-------------|
| `proxy-server.mjs` | Local Node.js proxy — handles CORS, caching, Dhan WebSocket |
| `src/lib/marketApi.ts` | API layer — all fetch calls to Dhan/NSE/TradingView |
| `src/hooks/useMarketData.ts` | React Query hooks — WebSocket → Polling → DB fallback |
| `src/lib/brokerConfig.ts` | Broker definitions and localStorage key management |
| `src/pages/Index.tsx` | Dashboard page — imports all dashboard widgets |

### Data Flow
```
Browser → useMarketData hooks → marketApi.ts → Proxy Server → Dhan/NSE/TradingView
                                                    ↕
                                        WebSocket (binary → JSON)
```

## How to Contribute

### 🐛 Bug Reports
- Open an [issue](https://github.com/MrChartist/india-s-best-option-hub/issues) with steps to reproduce
- Include browser, OS, and Node.js version
- Include screenshots if it's a UI issue

### 💡 Feature Requests
- Open an [issue](https://github.com/MrChartist/india-s-best-option-hub/issues) describing the feature
- Explain why it would be useful for F&O traders

### 🔧 Code Contributions

**High-impact areas where help is needed:**

1. **Broker Integrations** — Add support for Zerodha, Angel One, Upstox, etc.
2. **Mobile Responsiveness** — Make dashboard and option chain mobile-friendly
3. **Charts** — Better OI visualization, candlestick charts
4. **Testing** — Unit tests for hooks, API layer, and components
5. **Documentation** — Component docs, API docs, user guides
6. **Performance** — Optimize re-renders, lazy loading

## Coding Guidelines

### TypeScript
- All source code in `src/` must be TypeScript (`.ts` or `.tsx`)
- No `any` types unless absolutely necessary — prefer proper interfaces
- Use the existing type definitions in `src/lib/mockData.ts`

### Styling
- Use Tailwind CSS classes
- Use CSS variables from `src/index.css` for colors — never hardcode colors
- Test in both **dark** and **light** themes

### Data
- **No mock data** — all data must come from real APIs
- If a data source is unavailable, show a graceful empty state
- Use the existing fallback chain: Dhan → NSE → TradingView

### Components
- Use shadcn/ui components from `src/components/ui/` as the base
- Keep components focused and reusable
- Use React Query for data fetching (see existing hooks for patterns)

### Proxy Server
- `proxy-server.mjs` should remain dependency-free (except `ws`)
- No Express, no Axios — use native Node.js `http` and `fetch`

## Pull Request Process

1. Make sure your code builds: `npm run build`
2. Make sure linting passes: `npm run lint`
3. Test in both dark and light themes
4. Write a clear PR description explaining:
   - What changed
   - Why it changed
   - How to test it
5. Link any related issues

### PR Title Convention
```
feat: add Zerodha broker integration
fix: option chain not loading for FINNIFTY
docs: update API documentation
style: improve mobile layout for dashboard
refactor: simplify WebSocket reconnection logic
```

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Questions?** Open an issue or reach out. Happy coding! 🚀
