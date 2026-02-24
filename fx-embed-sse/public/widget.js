(function () {
    // auto detect backend origin from the script URL, so iframe always points to the same server
  const scriptElAtLoad = document.currentScript; 
  const backendOrigin = scriptElAtLoad 
    ? new URL(scriptElAtLoad.src, window.location.href).origin
    : window.location.origin;

  function initOne(host) {
    const base = (host.dataset.base || "PLN").toUpperCase();
    const symbols = (host.dataset.symbols || "EUR,USD,CHF,GBP,DKK").toUpperCase();
    const debug = host.dataset.debug === "1" ? "1" : "0";

    //set iframe
    const iframe = document.createElement("iframe");
    iframe.title = "FX Rates Widget";
    iframe.style.width = "100%";
    iframe.style.maxWidth = "420px";
    iframe.style.height = debug === "1" ? "380px" : "210px";
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
    
    const hosts = document.querySelectorAll("#fx-widget, .fx-widget");
    hosts.forEach(initOne);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
