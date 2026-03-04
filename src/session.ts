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

interface TabInfo {
  url: string;
}

interface SlotInfo {
  tabs: TabInfo[];
  active_tab: number;
}

interface MonitorGrid {
  grid: [number, number];
}

// sessionId → Map<screen_id, Monitor>
const sessions = new Map<string, Map<string, Monitor>>();
const counterMap = new Map<string, number>();
// slotId → SlotInfo
const slotState = new Map<string, SlotInfo>();
// monitorId → grid config
const monitorGrids = new Map<number, MonitorGrid>();

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

// Tab-aware slot state

function ensureSlot(slotId: string): SlotInfo {
  let slot = slotState.get(slotId);
  if (!slot) {
    slot = { tabs: [], active_tab: -1 };
    slotState.set(slotId, slot);
  }
  return slot;
}

export function setSlotUrl(slotId: string, url: string, tabIndex?: number): number {
  const slot = ensureSlot(slotId);
  const idx = tabIndex ?? 0;
  // Extend tabs array if needed
  while (slot.tabs.length <= idx) {
    slot.tabs.push({ url: "" });
  }
  slot.tabs[idx] = { url };
  slot.active_tab = idx;
  return idx;
}

export function switchSlotTab(slotId: string, tabIndex: number): boolean {
  const slot = slotState.get(slotId);
  if (!slot || tabIndex < 0 || tabIndex >= slot.tabs.length) return false;
  slot.active_tab = tabIndex;
  return true;
}

export function getSlotInfo(slotId: string): SlotInfo {
  return slotState.get(slotId) ?? { tabs: [], active_tab: -1 };
}

// Legacy compat
export function getSlotState(slotId: string): string | null {
  const slot = slotState.get(slotId);
  if (!slot || slot.tabs.length === 0) return null;
  const active = slot.active_tab >= 0 ? slot.active_tab : 0;
  return slot.tabs[active]?.url ?? null;
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

// Grid tracking

export function setMonitorGrid(monitorId: number, grid: [number, number]): void {
  monitorGrids.set(monitorId, { grid });
}

export function getMonitorGrid(monitorId: number): [number, number] | null {
  return monitorGrids.get(monitorId)?.grid ?? null;
}

// Get all slot states for a given monitorId
export function getMonitorSlots(monitorId: number): Record<string, SlotInfo> {
  const result: Record<string, SlotInfo> = {};
  for (const [key, val] of slotState) {
    if (key.match(new RegExp(`^${monitorId}[A-Z]`))) {
      const letter = key.replace(String(monitorId), "");
      result[letter] = val;
    }
  }
  return result;
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

// Get all monitors with screen_ids for layout capture/apply
export function getAllMonitorsFlat(): Array<{ session_id: string; screen_id: string; monitor_id: number }> {
  const result: Array<{ session_id: string; screen_id: string; monitor_id: number }> = [];
  for (const [sid, session] of sessions) {
    for (const monitor of session.values()) {
      result.push({ session_id: sid, screen_id: monitor.screen_id, monitor_id: monitor.monitor_id });
    }
  }
  return result;
}

export function findMonitorByScreenId(screenId: string): Monitor | undefined {
  for (const session of sessions.values()) {
    const m = session.get(screenId);
    if (m) return m;
  }
  return undefined;
}

// Last layout tracking
let lastLayout: string | null = null;

export function getLastLayout(): string | null {
  return lastLayout;
}

export function setLastLayout(name: string): void {
  lastLayout = name;
}
