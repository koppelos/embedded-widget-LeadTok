const qs = new URLSearchParams(location.search);
const base = (qs.get("base") || "PLN").toUpperCase();
const symbols = (qs.get("symbols") || "EUR,USD,CHF,GBP,DKK").toUpperCase();
const debug = qs.get("debug") === "1";

const h = document.getElementById("h");
const t = document.getElementById("t");
const meta = document.getElementById("meta");
const badge = document.getElementById("status");
const dbg = document.getElementById("dbg");
const thVal = document.getElementById("th-val");

if (debug && dbg) dbg.style.display = "block";
if (base === "PLN") {
  h.textContent = "Kursy względem PLN";
  if (thVal) thVal.textContent = "PLN";
} else {
  h.textContent = `1 ${base} = ...`;
  if (thVal) thVal.textContent = "Rate";
}

function setBadge(text, cls) {
  badge.textContent = text;
  badge.className = "badge " + (cls || "");
}

function clearTable() {
  while (t.firstChild) t.removeChild(t.firstChild);
}

function fmt(x) {
  return Number(x).toFixed(4);
}

function parseEventData(event, label) {
  try {
    return JSON.parse(event.data);
  } catch (error) {
    setBadge("bad payload", "err");
    if (debug && dbg) {
      dbg.textContent = `${label} parse error: ${String(error?.message || error)}`;
    }
    return null;
  }
}

//meta state
let lastFetchText = "";
let lastRatesMeta = { source: "", date: "", stale: false };

function renderMeta() {
  const parts = [];
  if (lastRatesMeta.source) parts.push(`Source: ${lastRatesMeta.source}`);
  if (lastRatesMeta.date) parts.push(`Date: ${lastRatesMeta.date}`);
  parts.push(lastRatesMeta.stale ? "stale cache" : "fresh");
  if (lastFetchText) parts.push(`Last fetch: ${lastFetchText}`);
  meta.textContent = parts.join(" • ");
}

//trend state
const prevValues = new Map();

function trendOf(key, nextVal) {
  const prev = prevValues.get(key);
  prevValues.set(key, nextVal);

  if (typeof prev !== "number") return { dir: "same", changed: false };

  // avoid noise for tiny float diffs
  const eps = 0.00005;
  if (nextVal > prev + eps) return { dir: "up", changed: true };
  if (nextVal < prev - eps) return { dir: "down", changed: true };
  return { dir: "same", changed: false };
}

function addRow(label, key, value) {
  const tr = document.createElement("tr");

  const td1 = document.createElement("td");
  td1.className = "sym";
  td1.textContent = label;

  const td2 = document.createElement("td");
  td2.className = "val";
  td2.dataset.key = key;

  const { dir, changed } = trendOf(key, value);

  const arrow = document.createElement("span");
  arrow.className = "arrow " + dir;
  arrow.textContent = dir === "up" ? "↑" : dir === "down" ? "↓" : "•";

  const num = document.createElement("span");
  num.className = "num";
  num.textContent = fmt(value);

  td2.appendChild(arrow);
  td2.appendChild(num);

  // flash only on real change
  if (changed) {
    td2.classList.add(dir === "up" ? "flash-up" : "flash-down");
    // force reflow for repeated animation
    void td2.offsetWidth;
    setTimeout(() => {
      td2.classList.remove("flash-up", "flash-down");
    }, 260);
  }

  tr.appendChild(td1);
  tr.appendChild(td2);
  t.appendChild(tr);
}

function render(r) {
  clearTable();
  const rates = r?.rates || {};
  const keys = Object.keys(rates);

  // keep a stable order for UX
  const preferred = ["EUR", "USD", "CHF", "GBP", "DKK"];
  const order = [...preferred.filter((x) => keys.includes(x)), ...keys.filter((x) => !preferred.includes(x)).sort()];

  if (base === "PLN") {
    for (const sym of order) {
      const x = Number(rates[sym]);
      if (!Number.isFinite(x) || x <= 0) continue;
      const pln = 1 / x;
      addRow(`1 ${sym}`, sym, pln);
    }
  } else {
    for (const sym of order) {
      const v = Number(rates[sym]);
      if (!Number.isFinite(v)) continue;
      addRow(sym, sym, v);
    }
  }

  lastRatesMeta = { source: r?.source || "", date: r?.date || "", stale: !!r?.stale };
  renderMeta();

  if (debug && dbg) {
    dbg.textContent = `ts=${r?.ts ?? ""} base=${r?.base ?? ""} symbols=${order.join(",")}`;
  }
}

// SSE
const sseUrl = new URL("/sse/rates", location.origin);
sseUrl.searchParams.set("base", base);
sseUrl.searchParams.set("symbols", symbols);

const es = new EventSource(sseUrl.toString());

es.addEventListener("status", (e) => {
  const s = parseEventData(e, "status");
  if (!s) return;

  if (s.stage === "connected") setBadge(s.stale ? "connected (stale)" : "connected", s.stale ? "warn" : "ok");
  else if (s.stage === "error") setBadge("error", "err");

  if (typeof s.providerLastFetchAt === "number" && s.providerLastFetchAt > 0) {
    lastFetchText = new Date(s.providerLastFetchAt).toLocaleTimeString();
    renderMeta();
  }
});

es.addEventListener("rates", (e) => {
  const r = parseEventData(e, "rates");
  if (!r) return;
  setBadge(r.stale ? "connected (stale)" : "connected", r.stale ? "warn" : "ok");
  render(r);
});

es.onerror = () => setBadge("reconnecting…", "warn");
