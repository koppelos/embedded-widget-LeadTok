## TL;DR (ENGLISH BELOW)
Embedded widget kursów walut dla stron partnerskich. Host ładuje `widget.js`, który montuje odizolowany iframe (`/frame`) i odbiera aktualizacje kursów w czasie rzeczywistym przez SSE (`/sse/rates`) z backendu Node.js + Express. Backend cyklicznie pobiera dane z API Frankfurter, cache’uje je i rozsyła do klientów.

---

## Live Demo
- Strona demo: `leadtok-embed-remi-koppel.web.app`
- Backend działa na Cloud Run i jest chroniony allowlistą domen (`EMBED_ORIGINS`).
- Można embeddować na innych stronach, ale ich origin musi zostać dodany do allowlisty w konfiguracji cloud.

---

## Snippet dla klienta

Minimalna wersja:

```html
<div id="fx-widget"></div>
<script src="https://<BACKEND_DOMAIN>/widget.js" defer></script>
```

Z opcjonalną konfiguracją:

```html
<div
  id="fx-widget"
  data-base="PLN"
  data-symbols="EUR,USD,CHF,GBP,DKK"
  data-debug="0"
></div>
<script src="https://<BACKEND_DOMAIN>/widget.js" defer></script>
```

Domyślne wartości:
- `base=PLN`
- `symbols=EUR,USD,CHF,GBP,DKK`

---

## Uruchomienie lokalne

Sklonuj repozytorium i uruchom:

```bash
cd fx-embed-sse
npm i
npm test
npm run dev
```

Otwórz w przeglądarce:
- `http://localhost:3000/demo`

Domyślna konfiguracja bezpieczeństwa w trybie lokalnym:
- `EMBED_ORIGINS=http://localhost:3000`

Aby tymczasowo dopuścić dodatkowe hosty lokalne (np. `5173`):

```bash
DEV_EMBED_ORIGINS=http://localhost:5173 npm run dev
```

---

## Architektura

- Backend: Node.js + Express  
- Izolacja widgetu: iframe  
- Dostarczanie danych w czasie rzeczywistym: SSE  
- Źródło kursów: Frankfurter `/latest` (polling + cache)  
- Klucz cache: `(base + symbols)` – zapobiega mieszaniu konfiguracji między różnymi instancjami widgetu  

---

## Bezpieczeństwo

- `EMBED_ORIGINS` kontroluje dostęp do `/frame` i `/sse/rates`
- Nagłówek CSP `frame-ancestors` określa, kto może osadzić iframe
- Nagłówek CORP dla `widget.js` wspiera restrykcyjne przeglądarki
- Ograniczenia SSE: `MAX_SSE_GLOBAL`, `MAX_SSE_PER_IP`
- Ochrona przed XSS: renderowanie wyłącznie przez API DOM / `textContent` (bez `innerHTML`)
- CSRF: brak endpointów modyfikujących stan, brak autoryzacji opartej o cookies w tym demo

---

## Konfiguracja

Użyj `fx-embed-sse/.env.example` jako szablonu.

Kluczowe zmienne:
- `SERVER_ORIGIN`
- `EMBED_ORIGINS`
- `TRUST_PROXY`
- `FETCH_EVERY_MS`
- `BROADCAST_EVERY_MS`
- `HEARTBEAT_MS`
- `MAX_SSE_GLOBAL`
- `MAX_SSE_PER_IP`

---

## Deploy

Backend jest niezależny od dostawcy. Możesz wdrożyć go na dowolnej platformie obsługującej kontenery lub procesy Node.js (np. Cloud Run, Fly.io, Render, Railway, AWS ECS/Fargate, Azure Container Apps, własna VM lub Kubernetes).

Minimalne wymagania:
- Publiczny dostęp przez HTTPS.
- Ustawienie `SERVER_ORIGIN` na publiczny adres backendu.
- Ustawienie `EMBED_ORIGINS` na dokładne originy stron klienckich (allowlista).
- Uruchomienie aplikacji przez `npm start`.

---

## Struktura repozytorium

- `fx-embed-sse/public/` – zasoby widgetu (`widget.js`, `frame.html`, `frame.js`, `frame.css`, `demo.html`)
- `fx-embed-sse/server.js` – bootstrap aplikacji i rejestracja tras
- `fx-embed-sse/src/` – moduły rdzeniowe (`config`, `security`, `rates`, `sse`, handlery tras)
- `fx-embed-sse/test/` – testy jednostkowe + integracyjne
- `evil/evil.html` – strona demonstracyjna do testów blokady (denylist)

---

## Demo bezpieczeństwa: Dozwolone vs Zablokowane

- Host demo znajduje się na allowliście → widget działa.
- Host „evil” nie znajduje się na allowliście → `/frame` i `/sse/rates` zwracają `403`.

Jeśli uruchomisz „evil host” lokalnie np:

```bash
cd evil
python3 -m http.server 5173
# otwórz http://localhost:5173/evil.html
```

Domyślnie powinien zostać zablokowany.

Zadziała tylko wtedy, gdy jawnie dopuścisz go w trybie deweloperskim:

```
DEV_EMBED_ORIGINS=http://localhost:5173 npm run dev
```




## TL;DR
This is an embeddable FX rates widget for partner websites. The host page loads `widget.js`, which mounts an isolated iframe (`/frame`) and receives live rate updates over SSE (`/sse/rates`) from a Node.js + Express backend that polls Frankfurter API and serves cached results.


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

Local dev security defaults:
- `EMBED_ORIGINS=http://localhost:3000`

To temporarily allow extra local hosts (for example `5173`), use:
```bash
DEV_EMBED_ORIGINS=http://localhost:5173 npm run dev
```

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
- `TRUST_PROXY`
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

## Trade-offs
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
It should be blocked by default.  
Only if you explicitly opt in with:
`DEV_EMBED_ORIGINS=http://localhost:5173 npm run dev`
