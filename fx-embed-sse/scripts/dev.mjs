import { spawn } from "node:child_process";

const port = String(process.env.PORT || "3000");
const serverOrigin = `http://localhost:${port}`;
const extraOrigins = String(process.env.DEV_EMBED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const embedOrigins = [serverOrigin, ...extraOrigins].join(",");

const env = {
  ...process.env,
  NODE_ENV: "development",
  REQUIRE_HTTPS: "false",
  TRUST_PROXY: "false",
  SERVER_ORIGIN: serverOrigin,
  EMBED_ORIGINS: embedOrigins,
};

console.log(
  `[dev] local security defaults: SERVER_ORIGIN=${env.SERVER_ORIGIN} EMBED_ORIGINS=${env.EMBED_ORIGINS}`
);

const nodemonCmd = process.platform === "win32" ? "nodemon.cmd" : "nodemon";
const nodemonArgs = [
  "--watch",
  "server.js",
  "--watch",
  "public",
  "--watch",
  "src",
  "--ext",
  "js,html,css",
  "--exec",
  "node server.js",
];

const child = spawn(nodemonCmd, nodemonArgs, {
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`[dev] failed to start nodemon: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
