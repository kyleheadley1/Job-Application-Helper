type Meta = Record<string, unknown>;

const log = (level: "INFO" | "WARN" | "ERROR", message: string, meta?: Meta): void => {
  const payload = {
    level,
    message,
    meta,
    timestamp: new Date().toISOString(),
  };
  // Intentionally plain JSON lines for production-friendly parsing.
  console.log(JSON.stringify(payload));
};

export const logger = {
  info: (message: string, meta?: Meta) => log("INFO", message, meta),
  warn: (message: string, meta?: Meta) => log("WARN", message, meta),
  error: (message: string, meta?: Meta) => log("ERROR", message, meta),
};
