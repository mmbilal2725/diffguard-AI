import Fastify, { type FastifyInstance } from "fastify";

export function buildApiServer(): FastifyInstance {
  const server = Fastify({
    logger: false
  });

  server.get("/health", async () => {
    return { status: "ok" };
  });

  return server;
}
