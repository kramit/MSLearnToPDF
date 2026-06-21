function nowIso() {
  return new Date().toISOString();
}

function emitProgress(onEvent, event) {
  if (!onEvent) return;
  onEvent({
    timestamp: nowIso(),
    severity: "info",
    stage: "general",
    ...event
  });
}

function createConsoleReporter() {
  return (event) => {
    const prefix = `[${event.severity.toUpperCase()}] ${event.stage}`;
    if (event.severity === "error") console.error(`${prefix} ${event.message}`);
    else if (event.severity === "warn") console.warn(`${prefix} ${event.message}`);
    else console.log(`${prefix} ${event.message}`);
  };
}

module.exports = {
  createConsoleReporter,
  emitProgress
};
