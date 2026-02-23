export function createLogger() {
  return function logEvent(event, fields = {}) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...fields,
      })
    );
  };
}
