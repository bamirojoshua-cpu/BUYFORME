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
npm install
npm run dev
```

Then open:

- **Home:** http://localhost:5173/
- **Login:** http://localhost:5173/auth.html
- **Shopper dashboard:** http://localhost:5173/shopper-dashboard.dev.html

Use port **5173** (not plain `localhost` without a port). Stop any old server with `Ctrl+C` and run `npm run dev` again if the page won’t load.

## GitHub Pages setup (recommended)

1. Repo **Settings → Pages**
2. **Source:** GitHub Actions (not “Deploy from branch”)
3. Push to `main` — the workflow `.github/workflows/deploy-pages.yml` builds and deploys `dist/`

Live URL: https://bamirojoshua-cpu.github.io/BUYFORME/shopper-dashboard.html
