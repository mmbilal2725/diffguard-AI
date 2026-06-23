import { buildApiServer } from "./server.js";
import { createApiConfig } from "./config.js";

const config = createApiConfig(process.env);

const server = buildApiServer({
  allowedOrigins: config.allowedOrigins,
  bodyLimitBytes: config.bodyLimitBytes,
  dashboardApiKey: config.dashboardApiKey,
  demoMode: config.demoMode,
  rateLimit: config.rateLimit,
  webhookSecret: config.webhookSecret,
});

try {
  await server.listen({ host: config.host, port: config.port });
  server.log.info({ host: config.host, port: config.port }, "DiffGuard API listening");
} catch (error) {
  server.log.error(error, "Failed to start DiffGuard API");
  process.exit(1);
}
