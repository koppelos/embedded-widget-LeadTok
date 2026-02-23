import express from "express";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./src/config.js";
import { createLogger } from "./src/logger.js";
import { createRatesService } from "./src/rates.js";
import { createRouteHandlers, staticHeaders } from "./src/routes.js";
import { createSseHub } from "./src/sse.js";
import { createSecurity } from "./src/security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const config = loadConfig(process.env);
const logEvent = createLogger();

const app = express();
const ratesService = createRatesService({
  fetchEveryMs: config.fetchEveryMs,
  logger: logEvent,
});

const security = createSecurity({
  embedOrigins: config.embedOrigins,
  serverOrigin: config.serverOrigin,
  logger: logEvent,
});

const sseHub = createSseHub({
  maxGlobalConnections: config.maxSseGlobal,
  maxPerIpConnections: config.maxSsePerIp,
  heartbeatMs: config.heartbeatMs,
  broadcastEveryMs: config.broadcastEveryMs,
  fetchEveryMs: config.fetchEveryMs,
  ratesService,
  logger: logEvent,
});

const routes = createRouteHandlers({
  publicDir,
  config,
  security,
  ratesService,
  sseHub,
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  compression({
    filter: (req, res) => {
      if (req.path === "/sse/rates") return false;
      return compression.filter(req, res);
    },
  })
);

app.disable("x-powered-by");

app.get("/demo", routes.demo);
app.get("/frame", routes.frame);

app.use(
  express.static(publicDir, {
    maxAge: "0",
    setHeaders: staticHeaders,
  })
);

app.options("/sse/rates", routes.sseOptions);
app.get("/sse/rates", routes.sseRates);

sseHub.startBroadcast();

const server = app.listen(config.port);

function shutdown() {
  sseHub.stopBroadcast();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
