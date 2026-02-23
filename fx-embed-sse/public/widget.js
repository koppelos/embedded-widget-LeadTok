(function () {
  function initOne(host) {
    const base = (host.dataset.base || "PLN").toUpperCase();
    const symbols = (host.dataset.symbols || "EUR,USD,CHF,GBP,DKK").toUpperCase();
    const debug = host.dataset.debug === "1" ? "1" : "0";

    const scriptEl = document.currentScript;
    const backendOrigin = scriptEl ? new URL(scriptEl.src).origin : window.location.origin;

    const iframe = document.createElement("iframe");
    iframe.title = "FX Rates Widget";
    iframe.style.width = "100%";
    iframe.style.maxWidth = "420px";
    iframe.style.height = debug === "1" ? "350px" : "210px";
    iframe.style.border = "0";
    iframe.style.borderRadius = "12px";
    iframe.style.overflow = "hidden";
    iframe.setAttribute("loading", "lazy");

    const src = new URL("/frame", backendOrigin);
    src.searchParams.set("base", base);
    src.searchParams.set("symbols", symbols);
    src.searchParams.set("debug", debug);
    iframe.src = src.toString();

    host.textContent = "";
    host.appendChild(iframe);
  }

  function init() {
    // wersja pro: wspiera wiele widgetów, ale dalej działa z #fx-widget
    const hosts = document.querySelectorAll("#fx-widget, .fx-widget");
    hosts.forEach(initOne);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();