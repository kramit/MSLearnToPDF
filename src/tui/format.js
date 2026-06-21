const { formatBytes, formatDuration } = require("../shared");

function buildTheme(noColor = Boolean(process.env.NO_COLOR)) {
  return {
    noColor,
    colors: noColor
      ? {}
      : {
          azure: "#0f6cbd",
          cyan: "#27c2ff",
          green: "#1a8f52",
          amber: "#c57f17",
          red: "#c42b1c",
          magenta: "#b146c2",
          slate: "#6b7280",
          white: "#ffffff",
          panel: "#d1d9e0"
        }
  };
}

function formatRate(bytesPerSecond) {
  const value = Math.max(0, Number(bytesPerSecond) || 0);
  return `${formatBytes(value)}/s`;
}

function describeTransfer(event) {
  const transferred = formatBytes(event.bytesTransferred || 0);
  const total = event.contentLength ? ` of ${formatBytes(event.contentLength)}` : "";
  const rate = event.transferBytesPerSecond
    ? ` at ${formatRate(event.transferBytesPerSecond)}`
    : "";
  return `${event.transferLabel || event.transferUrl || "download"} ${transferred}${total}${rate}`;
}

function lineForEvent(event) {
  if (["network-start", "network-complete"].includes(event.stage)) {
    return `${event.timestamp.slice(11, 19)} INFO  ${event.stage.padEnd(14)} ${describeTransfer(event)}`;
  }
  if (event.stage === "network-error") {
    return `${event.timestamp.slice(11, 19)} ${event.severity.toUpperCase().padEnd(5)} ${event.stage.padEnd(14)} ${describeTransfer(event)}`;
  }
  if (event.stage === "rate-limit" || event.stage === "retry-backoff") {
    const retryIn = event.retryDelayMs
      ? ` retry in ${formatDuration(event.retryDelayMs)}`
      : "";
    const attempt =
      event.retryNextAttempt && event.retryMaxAttempts
        ? ` attempt ${event.retryNextAttempt}/${event.retryMaxAttempts}`
        : "";
    const status = event.httpStatus ? ` HTTP ${event.httpStatus}` : "";
    const label = event.transferLabel ? ` ${event.transferLabel}` : "";
    return `${event.timestamp.slice(11, 19)} ${event.severity.toUpperCase().padEnd(5)} ${event.stage.padEnd(14)}${status}${label}${retryIn}${attempt} | ${event.message}`;
  }
  const prefix = `${event.timestamp.slice(11, 19)} ${event.severity.toUpperCase().padEnd(5)} ${event.stage.padEnd(14)}`;
  const scope = [
    event.courseCode,
    event.learningPathTitle,
    event.moduleTitle,
    event.unitTitle
  ]
    .filter(Boolean)
    .join(" > ");
  return scope ? `${prefix} ${scope} | ${event.message}` : `${prefix} ${event.message}`;
}

module.exports = {
  buildTheme,
  describeTransfer,
  formatRate,
  lineForEvent
};
