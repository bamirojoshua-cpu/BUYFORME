# Deploying BuyForMe (GitHub Pages)

The shopper dashboard uses a **Vite + React build**. GitHub Pages cannot run `/src/...` directly.

## Production build

```bash
npm install
npm run build
```

This updates `shopper-dashboard.html` and `assets/` at the repo root for GitHub Pages.

## Local development

```bash
npm run dev
```

Open `http://localhost:5173/shopper-dashboard.dev.html`

## GitHub Pages setup (recommended)

1. Repo **Settings → Pages**
2. **Source:** GitHub Actions (not “Deploy from branch”)
3. Push to `main` — the workflow `.github/workflows/deploy-pages.yml` builds and deploys `dist/`

Live URL: https://bamirojoshua-cpu.github.io/BUYFORME/shopper-dashboard.html
