// Alertas de vencimiento. No pide permiso ni toca la pantalla:
// arma la lista y recuerda qué notificación ya se mostró hoy.

import { nextCardDate, parseIsoDate } from "./card-math.js";
import { nextSubscriptionDate } from "./projections.js";

export const ALERTS_KEY = "simpla-alerts";
export const ALERTS_SHOWN_KEY = "simpla-alert-shown";

export function todayIso(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function readAlertPrefs(storage) {
  const fallback = { enabled: true, daysAhead: 3 };
  try {
    const raw = storage.getItem(ALERTS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const days = Number(parsed.daysAhead);
    return {
      enabled: parsed.enabled !== false,
      daysAhead: Number.isInteger(days) && days >= 0 && days <= 30 ? days : 3,
    };
  } catch (error) {
    return fallback;
  }
}

export function saveAlertPrefs(prefs, storage) {
  const days = Number(prefs.daysAhead);
  storage.setItem(ALERTS_KEY, JSON.stringify({
    enabled: prefs.enabled !== false,
    daysAhead: Number.isInteger(days) && days >= 0 && days <= 30 ? days : 3,
  }));
}

export function readShown(storage) {
  try {
    const raw = storage.getItem(ALERTS_SHOWN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

export function saveShown(shown, storage) {
  storage.setItem(ALERTS_SHOWN_KEY, JSON.stringify(shown));
}

export function freshAlerts(alerts, shown, today) {
  return alerts.filter((alert) => shown[alert.id] !== today);
}

export function markShown(shown, alerts, today) {
  const next = { ...shown };
  for (const alert of alerts) next[alert.id] = today;
  return next;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoOf(parts) {
  const last = new Date(parts.year, parts.month + 1, 0).getDate();
  const day = Math.min(Math.max(1, Number(parts.day) || 1), last);
  return `${parts.year}-${pad(parts.month + 1)}-${pad(day)}`;
}

function daysUntil(today, target) {
  const start = parseIsoDate(today);
  const end = parseIsoDate(target);
  if (!start || !end) return null;
  return Math.round((Date.UTC(end.year, end.month, end.day) - Date.UTC(start.year, start.month, start.day)) / 86400000);
}

function nextMonthDay(today, day) {
  const parsed = parseIsoDate(today);
  const due = Number(day);
  if (!parsed || !Number.isInteger(due) || due < 1 || due > 31) return null;
  let cursor = { year: parsed.year, month: parsed.month, day: due };
  let iso = isoOf(cursor);
  if (iso < today) {
    const nextMonth = parsed.month === 11 ? 0 : parsed.month + 1;
    const year = parsed.month === 11 ? parsed.year + 1 : parsed.year;
    cursor = { year, month: nextMonth, day: due };
    iso = isoOf(cursor);
  }
  return iso;
}

function weekday(iso) {
  const parsed = parseIsoDate(iso);
  if (!parsed) return "";
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(parsed.year, parsed.month, parsed.day)));
}

function when(days, date, weekdayName) {
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (weekdayName) return `el ${weekday(date)}`;
  return `en ${days} días`;
}

function ahead(today, date, daysAhead) {
  const days = daysUntil(today, date);
  if (days == null || days < 0 || days > daysAhead) return null;
  return days;
}

export function dueSoon(data, today, daysAhead = 3) {
  const window = Number.isInteger(daysAhead) && daysAhead >= 0 ? Math.min(daysAhead, 30) : 3;
  const alerts = [];
  if (!parseIsoDate(today)) return alerts;

  for (const card of data.cards || []) {
    const name = card.name || "La tarjeta";
    const closing = nextCardDate(card, today, "closing");
    const closingIn = closing ? ahead(today, closing, window) : null;
    if (closingIn != null) {
      alerts.push({
        id: `cierre:${card.id}:${closing}`,
        kind: "cierre",
        date: closing,
        days: closingIn,
        title: name,
        detail: "Cierre",
        text: `${name} cierra ${when(closingIn, closing, false)}`,
      });
    }
    const due = nextCardDate(card, today);
    const dueIn = due ? ahead(today, due, window) : null;
    if (dueIn != null) {
      alerts.push({
        id: `vence:${card.id}:${due}`,
        kind: "vencimiento",
        date: due,
        days: dueIn,
        title: name,
        detail: "Vencimiento",
        text: `${name} vence ${when(dueIn, due, false)}`,
      });
    }
  }

  for (const service of data.services || []) {
    const explicit = String(service.due_on || service.next_due_on || "").slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(explicit) ? explicit : nextMonthDay(today, service.due_day);
    if (!date) continue;
    const days = ahead(today, date, window);
    if (days == null) continue;
    alerts.push({
      id: `servicio:${service.id}:${date}`,
      kind: "servicio",
      date,
      days,
      title: service.name,
      detail: "Factura",
      text: `${service.name} vence ${when(days, date, false)}`,
    });
  }

  for (const subscription of data.subscriptions || []) {
    const date = nextSubscriptionDate(subscription, today);
    if (!date) continue;
    const days = ahead(today, date, window);
    if (days == null) continue;
    alerts.push({
      id: `suscripcion:${subscription.id || subscription.name}:${date}`,
      kind: "suscripcion",
      date,
      days,
      title: subscription.name,
      detail: subscription.on_card === true ? "Cobro · en tarjeta" : "Cobro",
      text: `${subscription.name} cobra ${when(days, date, true)}`,
    });
  }

  alerts.sort((a, b) => a.days - b.days || a.text.localeCompare(b.text, "es"));
  return alerts;
}
