# LeadTok FX Rate Embed
Embeddable PLN FX rate as iframe isolation and SSE updates.  

## Live Demo
- Demo page: `leadtok-embed-remi-koppel.web.app`
- Backend runs on Cloud Run and is protected by a domain allowlist (`EMBED_ORIGINS`).
- Can be embedded on other pages, but needs to be added to allowlist on cloud.

## Client Snippet
Minimal:

```html
<div id="fx-widget"></div>
<script src="https://<BACKEND_DOMAIN>/widget.js" defer></script>
```

Optional config:

```html
<div
  id="fx-widget"
  data-base="PLN"
  data-symbols="EUR,USD,CHF,GBP,DKK"
  data-debug="0"
></div>
<script src="https://<BACKEND_DOMAIN>/widget.js" defer></script>
```

Defaults:
- `base=PLN`
- `symbols=EUR,USD,CHF,GBP,DKK`

## Local Run
Clone the repo and:
```bash
cd fx-embed-sse
npm i
npm test
npm run dev
```

Open:
- `http://localhost:3000/demo`

## Architecture
- Backend: Node.js + Express
- Embed isolation: iframe
- Real-time delivery: SSE
- Upstream rates: Frankfurter `/latest` (poll + cache)
- Cache key: `(base + symbols)` (prevents config mixing)


## Security
- `EMBED_ORIGINS` allowlist gates `/frame` and `/sse/rates`
- CSP `frame-ancestors` controls who can embed
- CORP header on `widget.js` supports strict browsers (e.g. Brave)
- SSE guardrails: `MAX_SSE_GLOBAL`, `MAX_SSE_PER_IP`
- XSS: rendering uses DOM APIs / `textContent` (no `innerHTML`)
- CSRF: no mutating endpoints, no cookie-based auth in this demo

## Configuration
Use `fx-embed-sse/.env.example` as a template.

Key variables:
- `SERVER_ORIGIN`
- `EMBED_ORIGINS`
- `FETCH_EVERY_MS`
- `BROADCAST_EVERY_MS`
- `HEARTBEAT_MS`
- `MAX_SSE_GLOBAL`
- `MAX_SSE_PER_IP`

## Deploy 
This backend is provider-agnostic. You can deploy it to any platform that runs Node.js containers/processes (for example: Cloud Run, Fly.io, Render, Railway, AWS ECS/Fargate, Azure Container Apps, or your own VM/Kubernetes).

Minimum requirements:
- Expose the app publicly over HTTPS.
- Set `SERVER_ORIGIN` to your public backend origin.
- Set `EMBED_ORIGINS` to exact client site origins (allowlist).
- Run `npm start`.

## Decisions / Trade-offs
- Iframe over Web Components: stronger CSS/JS isolation for unknown host pages.
- SSE over WebSocket: simpler server/client model for one-way stream updates.
- “Real-time” here means real-time delivery to client; upstream data source is polled snapshots + caching.

## Repo Structure
- `fx-embed-sse/public/` widget assets (`widget.js`, `frame.html`, `frame.js`, `frame.css`, `demo.html`)
- `fx-embed-sse/server.js` app bootstrap and route wiring
- `fx-embed-sse/src/` core modules (`config`, `security`, `rates`, `sse`, route handlers)
- `fx-embed-sse/test/` unit + integration-style tests
- `evil/evil.html` denylist demonstration page

## Security Demo: Allowed vs Blocked
- Demo host is allowlisted -> widget works.
- Evil host is not allowlisted -> `/frame` and `/sse/rates` return `403`.

If evil host is running at: 
```cd evil
python3 -m http.server 5173
#open http://localhost:5173/evil.html
```
Add the origin to `EMBED_ORIGINS` when starting the local server.
`EMBED_ORIGINS="http://localhost:3000,http://localhost:5173" npm run dev`


