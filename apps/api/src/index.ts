import { buildApiServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const server = buildApiServer();

try {
  await server.listen({ host, port });
  server.log.info({ host, port }, "DiffGuard API listening");
} catch (error) {
  server.log.error(error, "Failed to start DiffGuard API");
  process.exit(1);
}
