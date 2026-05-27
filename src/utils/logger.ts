import pino from "pino";

export const logger = pino({
  name: "sitecore-search-integrity-monitor",
  level: process.env.LOG_LEVEL ?? "info",
});
