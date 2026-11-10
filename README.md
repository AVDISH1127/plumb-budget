# Plumb — A Clearer View of Your Money

> Small choices, seen clearly. That's where better habits begin.

Plumb is a lightweight, privacy-conscious personal budgeting tool that turns everyday spending into a clear, honest picture of where your money goes. Log income and expenses, set monthly budgets by category, and watch your habits take shape — all without spreadsheets or clutter.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup](#database-setup)
  - [Running Locally](#running-locally)
- [Available Scripts](#available-scripts)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Deployment](#deployment)
- [Testing](#testing)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Data & Privacy](#data--privacy)
- [License](#license)
- [Acknowledgements](#acknowledgements)

---

## Overview

Plumb answers one question well: **"Where did my money actually go this month?"**

Most budgeting apps bury you in dashboards and categories. Plumb keeps it minimal — a monthly overview, category budgets, a spending calendar, and a running log of recent activity. Add expenses in seconds (including by voice), and let the numbers speak for themselves.

**Design principles:**

- **Clarity over complexity** — every screen earns its place.
- **Small steps** — one transaction at a time builds better habits.
- **Your data is yours** — row-level security, no ads, no third-party tracking.
- **Works everywhere** — responsive from phone to desktop.

---

## Features

### Current

- 📊 **Monthly overview** — available balance, total spent, income received, all at a glance.
- 🧾 **Quick Add** — fast expense and income entry, including **voice input**.
- 🎯 **Category budgets** — set monthly limits for Food & dining, Transport, Housing, Shopping, and Other.
- 📅 **Spending calendar** — a heatmap-style daily view showing which days saw the most activity.
- 🕒 **Recent activity feed** — a rolling log of your latest transactions.
- 📥 **CSV import** — bring in existing data from other tools.
- 🔐 **Authentication** — secure accounts via Supabase Auth.
- 📱 **Mobile-first interactions** — hardened touch and layout behavior on small screens.

### In Progress / Planned

See the [Roadmap](#roadmap) for what's next.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Vite](https://vitejs.dev/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) (via PostCSS) |
| **Backend / Auth / DB** | [Supabase](https://supabase.com/) (Postgres + Auth + Row-Level Security) |
| **Deployment** | [Cloudflare Workers](https://workers.cloudflare.com/) (`wrangler.jsonc`) and/or [Netlify](https://netlify.com/) (`netlify.toml`) |
| **Testing** | Vitest (planned) |

---

## Architecture

```
┌─────────────────────┐        ┌──────────────────────┐
│   Browser (React)   │  HTTPS │   Supabase (Postgres)│
│  Vite build bundle  │ ─────► │  Auth + RLS + API    │
└─────────────────────┘        └──────────────────────┘
          ▲
          │ static assets
┌─────────────────────┐
│ Cloudflare Worker / │
│      Netlify CDN    │
└─────────────────────┘
```

- The **frontend** is a single-page React app compiled by Vite.
- **Supabase** handles authentication, stores all user data, and enforces per-user access through Row-Level Security policies.
- The build is served as **static assets** from Cloudflare Workers (or Netlify), so there's no custom server to maintain.
- **Environment variables are injected at build time** (Vite's `VITE_` prefix convention).

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18 (LTS recommended)
- **npm** (or `pnpm` / `yarn`)
- A **Supabase** project ([create one free](https://supabase.com/dashboard))
- Optional: **Wrangler CLI** for Cloudflare deployment, or a **Netlify** account

### Installation

```bash
git clone https://github.com/AVDISH1127/plumb-budget.git
cd plumb-budget
npm install
```

### Environment Variables

Copy the example file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

> ⚠️ **Important:** Vite only exposes variables prefixed with `VITE_` to the browser. Never put your Supabase **service role** key in a `VITE_` variable — it must stay server-side only.

Find these values in your Supabase dashboard under **Project Settings → API**.

### Database Setup

Run the SQL files in the `supabase/` directory against your project, either through the Supabase SQL editor or the CLI:

```bash
supabase db push
```

Ensure Row-Level Security (RLS) is enabled on all user tables so each user can only read and write their own rows.

### Running Locally

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (default Vite port).

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally for verification |
| `npm run lint` | Run ESLint across the codebase |

---

## Project Structure

```
plumb-budget/
├── public/              # Static assets served as-is
├── src/                 # React application source
│   ├── components/      # Reusable UI components
│   ├── pages/           # Route-level views
│   ├── lib/             # Supabase client, helpers, utilities
│   └── ...              # Hooks, types, styles
├── supabase/            # SQL migrations and schema definitions
├── tests/               # Test suites
├── index.html           # Vite entry HTML
├── vite.config.ts       # Vite configuration
├── tailwind / postcss   # Styling config
├── wrangler.jsonc       # Cloudflare Workers config
├── netlify.toml         # Netlify config
├── tsconfig*.json       # TypeScript config
├── .env.example         # Environment variable template
└── CHANGELOG.md         # Release history
```

---

## Data Model

At a high level, Plumb works with three core concepts:

| Entity | Purpose |
|---|---|
| **Transactions** | Individual expenses and income entries (amount, category, date, type, note). |
| **Categories** | Spending buckets with optional monthly budget limits (Food & dining, Transport, Housing, Shopping, Other). |
| **Users** | Authenticated accounts, each isolated by Row-Level Security. |

**Adding schema safely:** because all data lives in Supabase, treat migrations as *additive only* — add nullable columns or new tables, never drop or rename existing ones without a backup. See the [Roadmap](#roadmap) and any project-specific upgrade notes for guidance.

---

## Deployment

### Cloudflare Workers

The repo includes `wrangler.jsonc`. To deploy:

```bash
npm run build
npx wrangler deploy
```

Make sure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are available **at build time** in your CI/deploy environment — Vite inlines them into the bundle, so runtime-only secrets won't reach the client.

### Netlify

The repo includes `netlify.toml` with build settings. Connect the repo in Netlify, set the same two environment variables in **Site settings → Environment variables**, and deploy.

> 💡 **Tip:** Deploy to a preview URL first, verify data reads and writes, then promote to production.

---

## Testing

The `tests/` directory is scaffolded and ready for Vitest.

```bash
npm install -D vitest @testing-library/react
npx vitest
```

**Priority tests to write:**

1. Supabase data-layer functions (insert, update, soft-delete, restore).
2. Quick Add form validation — including the voice-input path.
3. That reads correctly filter out soft-deleted rows.
4. RLS policies — a user cannot read another user's transactions.

---

## Roadmap

### High priority
- [ ] **Fix production env wiring** — confirm Supabase keys reach the deployed build.
- [ ] **Prominent empty-state CTAs** — always-visible "Add expense / Add income" actions.
- [ ] **Edit & delete transactions** — with soft-delete and undo.
- [ ] **Real test coverage** for the data layer and forms.

### Medium priority
- [ ] **Month navigation** — browse past and future months.
- [ ] **Editable category budgets** — move limits into the database.
- [ ] **Charts & visualizations** — category donut, daily spending trend.
- [ ] **CSV export** — complement the existing import.
- [ ] **Recurring transactions** — rent, subscriptions, etc.

### Nice to have
- [ ] **Search & filter** on activity.
- [ ] **Savings goals** with progress tracking.
- [ ] **Custom categories** with icons and colors.
- [ ] **PWA / offline support**.
- [ ] **Dark mode**.
- [ ] **Accessibility pass** on the calendar heatmap.

---

## Contributing

Contributions are welcome!

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/your-feature`.
3. Make your changes, keeping commits focused and messages descriptive.
4. Ensure `npm run build` and `npm run lint` pass.
5. Open a pull request with a clear description of what changed and why.

**Guidelines:**

- Keep changes **additive** with respect to the database — never include destructive migrations.
- Match the existing minimalist UI style and Tailwind conventions.
- Include or update tests where practical.

---

## Data & Privacy

- All user data is stored in **your Supabase project**, protected by **Row-Level Security**.
- The frontend talks **directly to Supabase** over HTTPS — there is no intermediary server collecting data.
- No advertising, no third-party analytics, no selling of data.
- The **anon key** is safe to expose to the browser **only because RLS is enabled** — verify your policies before going live.

---

## License

This project is licensed under the **MIT License** — see `LICENSE` for details. *(Add a `LICENSE` file if one isn't present yet.)*

---

## Acknowledgements

- [Supabase](https://supabase.com/) for auth and database infrastructure.
- [Vite](https://vitejs.dev/) and [React](https://react.dev/) for the developer experience.
- [Tailwind CSS](https://tailwindcss.com/) for the design system.
- [Cloudflare Workers](https://workers.cloudflare.com/) and [Netlify](https://netlify.com/) for hosting.

---

<div align="center">

**Plumb** — *Small choices, seen clearly.*

</div>
