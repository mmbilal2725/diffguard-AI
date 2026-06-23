import { createServer, type Server } from "node:http";

export type WorkerHealthMetrics = {
  jobFailureCount: number;
  jobSuccessCount: number;
  modelCostUsd: number;
  reviewDurationMs: number;
  validatorRejectionRate: number;
};

export type WorkerHealthServerOptions = {
  logger?: {
    error(fields: Record<string, unknown>, message?: string): void;
    info(fields: Record<string, unknown>, message?: string): void;
  };
  metrics: () => WorkerHealthMetrics;
  port: number;
  readiness: () => Promise<boolean>;
};

export function startWorkerHealthServer(options: WorkerHealthServerOptions): Server {
  const server = createServer(async (request, response) => {
    if (request.url === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.url === "/ready") {
      const ready = await isReady(options.readiness);
      sendJson(response, ready ? 200 : 503, { status: ready ? "ok" : "unhealthy" });
      return;
    }

    if (request.url === "/metrics") {
      sendJson(response, 200, options.metrics());
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  });

  server.listen(options.port, "0.0.0.0", () => {
    options.logger?.info({ port: options.port, status: "started" }, "worker.health.started");
  });

  server.on("error", (error) => {
    options.logger?.error(
      {
        error: {
          message: error.message,
          name: error.name,
        },
        status: "failed",
      },
      "worker.health.failed",
    );
  });

  return server;
}

async function isReady(readiness: () => Promise<boolean>): Promise<boolean> {
  try {
    return await readiness();
  } catch {
    return false;
  }
}

function sendJson(
  response: { end(body: string): void; setHeader(name: string, value: string): void; statusCode: number },
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
