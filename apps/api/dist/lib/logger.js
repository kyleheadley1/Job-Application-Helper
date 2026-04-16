const log = (level, message, meta) => {
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
    info: (message, meta) => log("INFO", message, meta),
    warn: (message, meta) => log("WARN", message, meta),
    error: (message, meta) => log("ERROR", message, meta),
};
