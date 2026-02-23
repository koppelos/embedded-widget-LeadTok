# Security Guide

This project serves a third-party embeddable widget (`widget.js` + iframe + SSE).  
Treat it as an internet-facing integration service.

## Security Model

- Host page loads `widget.js` from this service.
- `widget.js` creates an iframe to `/frame`.
- iframe connects to `/sse/rates`.
- Access is controlled by explicit origin allowlists and CSP.

## Mandatory Production Settings

Set these environment variables in production:

- `NODE_ENV=production`
- `SERVER_ORIGIN=https://widgets.your-domain.com`
- `EMBED_ORIGINS=https://client-a.com,https://www.client-a.com`

Behavior enforced by config:

- Origins must be exact origins (no paths/query/hash).
- Wildcards (`*`) are rejected.
- In production, non-HTTPS origins are rejected.

## Origin and Embedding Policy

- Keep `EMBED_ORIGINS` minimal and explicit.
- Do not add temporary/dev origins in production.
- Review and remove unused client origins regularly.
- `allowSelf` is based on configured `SERVER_ORIGIN` (not request `Host`).

## HTTPS Requirements

- Serve this service only over HTTPS in production.
- Use valid TLS certificates.
- Do not allow mixed-content embeds.

## Client Integration Rules

Provide only this snippet to clients:

```html
<div id="fx-widget"></div>
<script src="https://widgets.your-domain.com/widget.js" defer></script>
```

Notes:

- Keep `widget.js` URL pinned to your trusted domain.
- Do not ask clients to self-host `widget.js` unless you control update flow.

## Runtime Hardening

- Keep SSE limits configured:
  - `MAX_SSE_GLOBAL`
  - `MAX_SSE_PER_IP`
- Keep polling intervals conservative:
  - `FETCH_EVERY_MS`
  - `BROADCAST_EVERY_MS`
  - `HEARTBEAT_MS`
- Keep logs centralized and monitored for:
  - `forbid_by_origin`
  - `sse_connect` / `sse_close`
  - `upstream_fetch_error`

## Dependency and Patch Hygiene

- Run dependency updates regularly.
- Patch high/critical vulnerabilities promptly.
- Re-run test suite after any dependency or config change:

```bash
npm test
```

## Security Testing Baseline

Before release:

- Config validation tests pass (`test/config.test.js`).
- Origin/CORS tests pass (`test/security.test.js`).
- Route behavior tests pass (`test/routes.test.js`).
- SSE isolation tests pass (`test/sse.test.js`).

## Incident Response

If abuse is detected:

1. Remove suspicious origin(s) from `EMBED_ORIGINS`.
2. Rotate `SERVER_ORIGIN` infrastructure credentials if applicable.
3. Tighten `MAX_SSE_*` limits.
4. Review logs for denied origins and unusual connection patterns.
5. Communicate impact and remediation to affected clients.
