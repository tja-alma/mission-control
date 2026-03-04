import type { WSContext } from "hono/ws";

interface Monitor {
  screen_id: string;
  monitor_id: number;
  ws: WSContext;
}

interface MonitorInfo {
  screen_id: string;
  monitor_id: number;
}

// sessionId → Map<screen_id, Monitor>
const sessions = new Map<string, Map<string, Monitor>>();
const counterMap = new Map<string, number>();
// slotId → url
const slotState = new Map<string, string>();

function getSession(sessionId: string): Map<string, Monitor> {
  let session = sessions.get(sessionId);
  if (!session) {
    session = new Map();
    sessions.set(sessionId, session);
  }
  return session;
}

function getNextMonitorId(sessionId: string): number {
  const current = counterMap.get(sessionId) ?? 0;
  const next = current + 1;
  counterMap.set(sessionId, next);
  return next;
}

export function registerMonitor(
  sessionId: string,
  screenId: string,
  ws: WSContext
): number {
  const session = getSession(sessionId);
  // Remove existing monitor with same screenId if reconnecting
  session.delete(screenId);
  const monitorId = getNextMonitorId(sessionId);
  session.set(screenId, { screen_id: screenId, monitor_id: monitorId, ws });
  return monitorId;
}

export function removeMonitor(sessionId: string, screenId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.delete(screenId);
    if (session.size === 0) {
      sessions.delete(sessionId);
    }
  }
}

export function findMonitorById(monitorId: number): Monitor | undefined {
  for (const session of sessions.values()) {
    for (const monitor of session.values()) {
      if (monitor.monitor_id === monitorId) return monitor;
    }
  }
  return undefined;
}

export function sendToMonitor(monitorId: number, message: object): boolean {
  const monitor = findMonitorById(monitorId);
  if (!monitor) return false;
  monitor.ws.send(JSON.stringify(message));
  return true;
}

export function broadcastToSession(
  sessionId: string,
  fn: (monitor: MonitorInfo) => object
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  for (const monitor of session.values()) {
    monitor.ws.send(JSON.stringify(fn(monitor)));
  }
}

export function broadcastToAll(fn: (monitor: MonitorInfo) => object): void {
  for (const session of sessions.values()) {
    for (const monitor of session.values()) {
      monitor.ws.send(JSON.stringify(fn(monitor)));
    }
  }
}

export function parseSlotId(slotId: string): { monitorId: number; letter: string } {
  const match = slotId.match(/^(\d+)([A-Z]+)$/);
  if (!match) throw new Error(`Invalid slotId: ${slotId}`);
  return { monitorId: parseInt(match[1], 10), letter: match[2] };
}

export function setSlotUrl(slotId: string, url: string): void {
  slotState.set(slotId, url);
}

export function getSlotState(slotId: string): string | null {
  return slotState.get(slotId) ?? null;
}

export function clearSlotState(slotId: string): void {
  slotState.delete(slotId);
}

export function clearMonitorSlots(monitorId: number): void {
  for (const key of Array.from(slotState.keys())) {
    if (key.match(new RegExp(`^${monitorId}[A-Z]`))) {
      slotState.delete(key);
    }
  }
}

export function getMonitors(sessionId?: string): Record<string, MonitorInfo[]> {
  const result: Record<string, MonitorInfo[]> = {};
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      result[sessionId] = Array.from(session.values()).map((m) => ({
        screen_id: m.screen_id,
        monitor_id: m.monitor_id,
      }));
    }
    return result;
  }
  for (const [sid, session] of sessions) {
    result[sid] = Array.from(session.values()).map((m) => ({
      screen_id: m.screen_id,
      monitor_id: m.monitor_id,
    }));
  }
  return result;
}
