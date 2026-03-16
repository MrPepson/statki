# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server at http://localhost:5173
npm run build     # type-check + production build (output: dist/)
npm run preview   # preview production build locally
npm run lint      # run ESLint
```

> Install deps with `npm install --legacy-peer-deps` — required because `@tailwindcss/vite` declares peer deps for Vite ≤7 while this project uses Vite 8.

## Stack

- **Vite 8** + **React 19** + **TypeScript 5.9**
- **Tailwind CSS v4** — integrated via `@tailwindcss/vite` plugin (no `tailwind.config.js`). CSS entry point is `src/index.css` with a single `@import "tailwindcss";`.
- **Supabase JS v2** — available for backend/realtime; not yet wired up.

## Architecture

The project is a blank canvas for a multiplayer Battleships (Statki) game. Currently only the shell exists:

- `src/main.tsx` — React root, mounts `<App />`
- `src/App.tsx` — top-level component (currently just the title screen)
- `src/index.css` — global styles (Tailwind import only)

Supabase will be used for multiplayer state and realtime updates. When adding it, create a `src/lib/supabase.ts` client singleton using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars.

## Conventions

- React components go in `src/components/`
- Game state and logic go in `src/store/`
- Variable and file names in English; comments in Polish
- Do not install new UI libraries without asking the user first
