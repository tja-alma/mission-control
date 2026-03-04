import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerMonitor,
  removeMonitor,
  getMonitors,
  sendToMonitor,
  broadcastToAll,
  parseSlotId,
  setSlotUrl,
  getSlotState,
  clearSlotState,
  clearMonitorSlots,
} from "./session.js";

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

// Screen identification
app.post("/api/screens/identify", (c) => {
  broadcastToAll((m) => ({ type: "identify", monitorId: m.monitor_id }));
  return c.json({ ok: true });
});

// Grid split
app.post("/api/screens/:monitorId/split", async (c) => {
  const monitorId = parseInt(c.req.param("monitorId"), 10);
  const body = await c.req.json<{ grid: [number, number] }>();
  const [rows, cols] = body.grid;

  clearMonitorSlots(monitorId);
  const sent = sendToMonitor(monitorId, { type: "split", grid: [rows, cols], monitorId });
  if (!sent) return c.json({ error: "monitor not found" }, 404);

  const slots: string[] = [];
  const total = rows * cols;
  for (let i = 0; i < total; i++) {
    slots.push(monitorId + String.fromCharCode(65 + i));
  }
  return c.json({ slots });
});

// Grid reset
app.post("/api/screens/:monitorId/reset", (c) => {
  const monitorId = parseInt(c.req.param("monitorId"), 10);
  clearMonitorSlots(monitorId);
  const sent = sendToMonitor(monitorId, { type: "split", grid: [1, 1], monitorId });
  if (!sent) return c.json({ error: "monitor not found" }, 404);
  return c.json({ ok: true });
});

// Slot load
app.post("/api/slots/:slotId/load", async (c) => {
  const slotId = c.req.param("slotId");
  const { monitorId } = parseSlotId(slotId);
  const body = await c.req.json<{ url: string }>();
  setSlotUrl(slotId, body.url);
  const sent = sendToMonitor(monitorId, { type: "load", slot: slotId, url: body.url });
  if (!sent) return c.json({ error: "monitor not found" }, 404);
  return c.json({ ok: true });
});

// Slot clear
app.post("/api/slots/:slotId/clear", (c) => {
  const slotId = c.req.param("slotId");
  const { monitorId } = parseSlotId(slotId);
  clearSlotState(slotId);
  const sent = sendToMonitor(monitorId, { type: "clear", slot: slotId });
  if (!sent) return c.json({ error: "monitor not found" }, 404);
  return c.json({ ok: true });
});

// Slot state
app.get("/api/slots/:slotId", (c) => {
  const slotId = c.req.param("slotId");
  const url = getSlotState(slotId);
  return c.json({ slot_id: slotId, url });
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
