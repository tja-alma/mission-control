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
