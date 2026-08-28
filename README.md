# IIT JAM Study Tracker

A standalone React/Vite version of the study tracker originally generated as a Claude artifact.

## Run locally

1. Install Node.js (LTS).
2. In this folder run:

```bash
npm install
npm run dev
```

3. Open the local URL shown by Vite (usually http://localhost:5173).

## Deploy

Build with `npm run build`. The generated `dist/` folder can be deployed to Vercel, Netlify, Cloudflare Pages, or GitHub Pages (with suitable Vite configuration).

## Data

Study sessions, blocks, and penalties are stored in the browser using `localStorage`, so data persists on the same browser/device. It is not synced between devices.
