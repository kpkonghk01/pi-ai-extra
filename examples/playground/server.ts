import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, readJsonBody, sendJson, sendStatic, serializeError } from "./src/http-utils.ts";
import { catalogRoute, chatRoute, imageRoute, taskRoute } from "./src/routes.ts";

/**
 * Local-only test harness. Keys are typed into the page, sent to this process on
 * 127.0.0.1 per request, passed to the packages and never stored or logged.
 */
const HOST = "127.0.0.1";
const PORT = Number(process.env.PLAYGROUND_PORT ?? 5178);
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);

const POST_ROUTES: Record<string, (body: unknown, response: ServerResponse) => Promise<void>> = {
  "/api/image": imageRoute,
  "/api/task": taskRoute,
  "/api/chat": chatRoute,
};

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  // Rejects DNS-rebinding requests that reach 127.0.0.1 under a foreign host name.
  if (!ALLOWED_HOSTS.has(request.headers.host ?? "")) throw new HttpError(403, "Unexpected Host header.");
  const path = new URL(request.url ?? "/", `http://${HOST}`).pathname;

  if (request.method === "GET" && path === "/api/catalog") return catalogRoute(response);
  if (request.method === "POST" && POST_ROUTES[path]) return POST_ROUTES[path](await readJsonBody(request), response);
  if (request.method === "GET" && !path.startsWith("/api/")) return sendStatic(response, PUBLIC_DIR, path);
  throw new HttpError(404, "Not found.");
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: serializeError(error) });
  });
});

// Image tasks can take several minutes; keep sockets open for the longest provider deadline.
server.requestTimeout = 15 * 60_000;
server.headersTimeout = 60_000;

server.listen(PORT, HOST, () => {
  console.info(`pi-ai-extra playground: http://${HOST}:${PORT}  (local only; keys are never stored)`);
});
