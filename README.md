# Box Packing Planner — README

This app helps you pack selected products into a box. It finds the smallest box that can hold them and shows step‑by‑step placement in 3D (floor‑first and stable). Built with React + TypeScript + React Three Fiber (Three.js). Bundled by Vite.

## Requirements
- Node.js 18+ (LTS recommended)
- npm 9+ (or pnpm/yarn — examples use npm)

Check versions:
```
node -v
npm -v
```

## Setup
Install dependencies:
```
cd /Users/dserin/Desktop/Test
npm install
```

## Development (local)
Start the dev server with HMR:
```
npm run dev
```
Open: http://localhost:5173

Allow LAN testing:
```
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

## Production build
Create deployable files:
```
npm run build
```
Output goes to `dist/`:
- dist/index.html
- dist/assets/index.js
- dist/assets/index.css

Note: Vite is configured to use fixed file names (no hashes) to make FTP upload easy.

## Preview (optional)
Serve the production build locally:
```
npm run preview
```
Alternative:
```
npx serve dist
# or
python3 -m http.server --directory dist 8080
```

## Deploy via FTP
1. Run `npm run build` to create `dist/`.
2. Upload the contents of `dist/` to your server.
3. Keep the structure: `index.html` at the root, JS/CSS inside `assets/`.
4. Ensure the server sends correct MIME types for CSS/JS.

## How to use (UI)
- Left panel:
  - Add a box (`Width/Depth/Height`) or select an existing one.
  - Click “Add random” to generate a product pool (name, barcode, SKU, sizes included).
  - Select products (single or “Select all”).
- Click “Suggest box and guide packing”:
  1) The app clusters products tightly in a virtual 3D space.
  2) It chooses the smallest real box that can fit that cluster.
  3) It guides you to place items in the box, floor‑first, step by step.
- Top‑right controls: “Placed” to confirm and go next, “Previous item” to go back.
- “Reset” clears everything.

## Algorithm (short)
- 3D compaction: beam‑search planner creates a compact cluster.
- Box selection: picks the smallest box that can hold the cluster (also tries W/D swap).
- Real box placement: floor‑first, flat orientations, full support; deterministic shelf (NFDH‑style) fallback for robust fills.

## Troubleshooting
- Blank page / 404: check that the `dist/` structure is uploaded correctly and the server serves CSS/JS with proper MIME types.
- `crypto.randomUUID is not a function`: the app uses `generateId()` in `src/util/id.ts` for compatibility. Replace any direct `randomUUID` with it.
- Port already in use: run dev on a different port, e.g. `npm run dev -- --port 5174`.

## Scripts
```
npm run dev       # start dev server
npm run build     # build to dist/
npm run preview   # serve dist/ locally
```

## Folder structure (quick)
- `src/ui/` — UI components (PackingUI.tsx, App.tsx)
- `src/viz/` — 3D scene (PackingScene.tsx)
- `src/util/` — State and algorithms (store.ts, id.ts, units.ts)
- `src/styles.css` — Styles
- `vite.config.ts` — Vite config (fixed asset names)
