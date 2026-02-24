export function createLogger() {
  return function logEvent(event, fields = {}) {
    // one JSON line per event for structured logs in local/dev/cloud runtimes
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...fields,
      })
    );
  };
}
