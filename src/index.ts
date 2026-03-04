import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerMonitor, removeMonitor, getMonitors } from "./session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// API routes
app.get("/", (c) => c.json({ name: "mc-grid", version: "0.1.0" }));

app.get("/api/session", (c) => {
  const sessionId = c.req.query("session_id");
  return c.json({ monitors: getMonitors(sessionId) });
});

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => {
    let registeredSession: string | undefined;
    let registeredScreen: string | undefined;

    return {
      onMessage(event, ws) {
        try {
          const data = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (data.type === "register") {
            const screenId = String(data.screenId ?? "");
            const sessionId = String(data.sessionId ?? "");
            if (!screenId || !sessionId) {
              ws.send(JSON.stringify({ error: "missing screenId or sessionId" }));
              return;
            }
            registeredSession = sessionId;
            registeredScreen = screenId;
            const monitorId = registerMonitor(sessionId, screenId, ws);
            ws.send(
              JSON.stringify({
                type: "welcome",
                monitorId,
                screenId,
              })
            );
          }
        } catch {
          ws.send(JSON.stringify({ error: "invalid json" }));
        }
      },
      onClose() {
        if (registeredSession && registeredScreen) {
          removeMonitor(registeredSession, registeredScreen);
        }
      },
    };
  })
);

// SPA route — serve index.html for /s/:sessionId
app.get("/s/:sessionId", (c) => {
  const html = readFileSync(join(publicDir, "index.html"), "utf-8");
  return c.html(html);
});

// Static files
app.use("/*", serveStatic({ root: "./public" }));

const port = parseInt(process.env["PORT"] ?? "3500", 10);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`mc-grid listening on port ${info.port}`);
});

injectWebSocket(server);
