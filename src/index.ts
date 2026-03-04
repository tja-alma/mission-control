import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync, statSync } from "node:fs";
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
  getSlotInfo,
  clearSlotState,
  clearMonitorSlots,
  switchSlotTab,
  setMonitorGrid,
  getMonitorGrid,
  getMonitorSlots,
  getAllMonitorsFlat,
  findMonitorByScreenId,
  getLastLayout,
  setLastLayout,
} from "./session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const layoutDir = join(process.cwd(), "data", "layouts", "thomas");

// Ensure layout directory exists
mkdirSync(layoutDir, { recursive: true });

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// API routes
app.get("/", (c) => c.json({ name: "mc-grid", version: "0.2.0" }));

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
  setMonitorGrid(monitorId, [rows, cols]);
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
  setMonitorGrid(monitorId, [1, 1]);
  const sent = sendToMonitor(monitorId, { type: "split", grid: [1, 1], monitorId });
  if (!sent) return c.json({ error: "monitor not found" }, 404);
  return c.json({ ok: true });
});

// Slot load (S6: tab support)
app.post("/api/slots/:slotId/load", async (c) => {
  const slotId = c.req.param("slotId");
  const { monitorId } = parseSlotId(slotId);
  const body = await c.req.json<{ url: string; tab?: number }>();
  const tabIndex = setSlotUrl(slotId, body.url, body.tab);
  const info = getSlotInfo(slotId);
  const sent = sendToMonitor(monitorId, {
    type: "load",
    slot: slotId,
    url: body.url,
    tab: tabIndex,
    tabs: info.tabs,
    active_tab: info.active_tab,
  });
  if (!sent) return c.json({ error: "monitor not found" }, 404);
  return c.json({ ok: true });
});

// S6: Switch tab
app.post("/api/slots/:slotId/tab", async (c) => {
  const slotId = c.req.param("slotId");
  const { monitorId } = parseSlotId(slotId);
  const body = await c.req.json<{ tab: number }>();
  const ok = switchSlotTab(slotId, body.tab);
  if (!ok) return c.json({ error: "invalid tab" }, 400);
  const sent = sendToMonitor(monitorId, { type: "switchTab", slot: slotId, tab: body.tab });
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

// Slot state (S6: returns tabs)
app.get("/api/slots/:slotId", (c) => {
  const slotId = c.req.param("slotId");
  const info = getSlotInfo(slotId);
  return c.json({ slot_id: slotId, tabs: info.tabs, active_tab: info.active_tab });
});

// S7: Save layout
app.post("/api/layouts", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = body.name;
  if (!name || /[^a-zA-Z0-9_\- ]/.test(name)) {
    return c.json({ error: "invalid layout name" }, 400);
  }

  const now = new Date().toISOString();
  const monitors: Record<string, object> = {};

  for (const m of getAllMonitorsFlat()) {
    const grid = getMonitorGrid(m.monitor_id) ?? [1, 1];
    const slots = getMonitorSlots(m.monitor_id);
    monitors[m.screen_id] = {
      monitor_id: m.monitor_id,
      grid,
      slots,
    };
  }

  const layout = {
    name,
    user: "thomas",
    created_at: now,
    updated_at: now,
    monitors,
  };

  const filePath = join(layoutDir, `${name}.json`);
  // Preserve created_at if updating
  if (existsSync(filePath)) {
    try {
      const existing = JSON.parse(readFileSync(filePath, "utf-8")) as { created_at?: string };
      if (existing.created_at) {
        layout.created_at = existing.created_at;
      }
    } catch {
      // ignore parse errors
    }
  }

  writeFileSync(filePath, JSON.stringify(layout, null, 2));
  return c.json({ ok: true, name });
});

// S7: List layouts
app.get("/api/layouts", (c) => {
  if (!existsSync(layoutDir)) {
    return c.json({ layouts: [] });
  }
  const files = readdirSync(layoutDir).filter((f) => f.endsWith(".json"));
  const layouts = files.map((f) => {
    const filePath = join(layoutDir, f);
    const stat = statSync(filePath);
    const name = f.replace(/\.json$/, "");
    return { name, updated_at: stat.mtime.toISOString() };
  });
  return c.json({ layouts });
});

// S7: Get layout
app.get("/api/layouts/:name", (c) => {
  const name = c.req.param("name");
  const filePath = join(layoutDir, `${name}.json`);
  if (!existsSync(filePath)) return c.json({ error: "not found" }, 404);
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  return c.json(data);
});

// S8: Apply layout
app.post("/api/layouts/:name/apply", (c) => {
  const name = c.req.param("name");
  const filePath = join(layoutDir, `${name}.json`);
  if (!existsSync(filePath)) return c.json({ error: "not found" }, 404);

  const layout = JSON.parse(readFileSync(filePath, "utf-8")) as {
    monitors: Record<string, {
      monitor_id: number;
      grid: [number, number];
      slots: Record<string, { tabs: Array<{ url: string }>; active_tab: number }>;
    }>;
  };

  const appliedMonitors: string[] = [];

  for (const [screenId, monitorLayout] of Object.entries(layout.monitors)) {
    const monitor = findMonitorByScreenId(screenId);
    if (!monitor) continue;

    const mid = monitor.monitor_id;
    const grid = monitorLayout.grid;

    // Send split
    clearMonitorSlots(mid);
    setMonitorGrid(mid, grid);
    monitor.ws.send(JSON.stringify({ type: "split", grid, monitorId: mid }));

    // Load slots
    const total = grid[0] * grid[1];
    for (let i = 0; i < total; i++) {
      const letter = String.fromCharCode(65 + i);
      const slotId = mid + letter;
      const slotLayout = monitorLayout.slots[letter];
      if (slotLayout && slotLayout.tabs.length > 0) {
        for (let t = 0; t < slotLayout.tabs.length; t++) {
          const tab = slotLayout.tabs[t];
          if (tab.url) {
            setSlotUrl(slotId, tab.url, t);
          }
        }
        const info = getSlotInfo(slotId);
        // Switch to saved active tab
        if (slotLayout.active_tab >= 0 && slotLayout.active_tab < slotLayout.tabs.length) {
          switchSlotTab(slotId, slotLayout.active_tab);
        }
        const finalInfo = getSlotInfo(slotId);
        monitor.ws.send(JSON.stringify({
          type: "loadAll",
          slot: slotId,
          tabs: finalInfo.tabs,
          active_tab: finalInfo.active_tab,
        }));
      }
    }

    appliedMonitors.push(screenId);
  }

  // Track the last applied layout for auto-restore
  setLastLayout(name);

  return c.json({ ok: true, applied_monitors: appliedMonitors });
});

// S8: Delete layout
app.delete("/api/layouts/:name", (c) => {
  const name = c.req.param("name");
  const filePath = join(layoutDir, `${name}.json`);
  if (!existsSync(filePath)) return c.json({ error: "not found" }, 404);
  unlinkSync(filePath);
  return c.json({ ok: true });
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
