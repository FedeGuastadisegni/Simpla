import { listRows, onData } from "./db.js";
import { amountNode, putAmount } from "./money-view.js";
import { combinedForecast, monthDelta } from "./combined.js";
import { upcomingPayments } from "./projections.js";

function money(amount, currency) {
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === "USD" ? `USD ${formatted}` : `$ ${formatted}`;
}

function currentMonth() {
  const date = new Date();
  return { year: date.getFullYear(), month: date.getMonth() };
}

function monthTitle(month) {
  const date = new Date(month.year, month.month, 1);
  const name = new Intl.DateTimeFormat("es-AR", { month: "long" }).format(date);
  return name.charAt(0).toLocaleUpperCase("es-AR") + name.slice(1);
}

function clear(node) {
  if (node) node.replaceChildren();
}

function add(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.append(node);
  return node;
}

function paintChange(node, delta) {
  let any = false;
  for (const currency of ["ARS", "USD"]) {
    const value = delta[currency];
    if (value === 0) continue;
    if (any) node.append(" · ");
    any = true;
    const verb = value < 0 ? "Baja" : "Sube";
    node.append(`${verb} `, amountNode(Math.abs(value), currency));
  }
  if (!any) node.textContent = "Igual que este mes";
}

async function load() {
  const [cards, cardItems, loans, services, serviceBills, subscriptions] = await Promise.all([
    listRows("cards"),
    listRows("card_items"),
    listRows("loans"),
    listRows("services"),
    listRows("service_bills"),
    listRows("subscriptions"),
  ]);
  return { cards, cardItems, loans, services, serviceBills, subscriptions };
}

function hasAnything(data) {
  return data.cardItems.length + data.loans.length + data.serviceBills.length + data.subscriptions.length > 0;
}

function paintRing(month) {
  const ring = document.getElementById("inicio-ring");
  const pct = document.getElementById("inicio-ring-pct");
  const arc = ring?.querySelector(".ring-value");
  if (!ring || !pct || !arc) return;
  if (!month) {
    ring.hidden = true;
    return;
  }
  const total = Number(month.totals?.ARS) || 0;
  const card = Number(month.tarjeta?.ARS) || 0;
  const ratio = total > 0 ? Math.min(Math.max(card / total, 0), 1) : 0;
  const percent = Math.round(ratio * 100);
  const radius = Number(arc.getAttribute("r")) || 54;
  const length = 2 * Math.PI * radius;
  arc.style.strokeDasharray = `${(ratio * length).toFixed(1)} ${length.toFixed(1)}`;
  pct.textContent = `${percent}%`;
  ring.setAttribute("aria-label", `Tarjeta, ${percent}% del comprometido`);
  ring.hidden = false;
}

function paintBars(months, enabled) {
  const items = document.querySelectorAll("#month-rail li");
  const values = enabled ? months.map((month) => Number(month.totals?.ARS) || 0) : [];
  const max = values.reduce((peak, value) => Math.max(peak, value), 0);
  items.forEach((item, index) => {
    if (!enabled || max <= 0) {
      item.style.setProperty("--bar", index === 0 ? "1" : "0.62");
      return;
    }
    const ratio = Math.max((values[index] || 0) / max, 0.18);
    item.style.setProperty("--bar", ratio.toFixed(3));
  });
}

function paintInicio(months, data) {
  const display = document.getElementById("inicio-total");
  const usd = document.getElementById("inicio-usd");
  const next = document.getElementById("inicio-next");
  if (!display || !usd || !next) return;
  if (!hasAnything(data)) {
    display.textContent = "Sin datos";
    usd.hidden = true;
    next.textContent = "Cuando haya datos, acá vas a ver cómo cambia el mes que viene.";
    paintRing(null);
    paintBars(months, false);
    return;
  }
  const now = months[0];
  const later = months[1];
  display.textContent = money(now.totals.ARS, "ARS");
  usd.hidden = false;
  putAmount(usd, now.totals.USD, "USD");
  next.replaceChildren(`El mes que viene ${money(later.totals.ARS, "ARS")} · `, amountNode(later.totals.USD, "USD"));
  paintRing(now);
  paintBars(months, true);
}

function categoryRow(parent, label, fill) {
  const row = add(parent, "div", "forecast");
  const line = add(row, "div", "timeline-cat");
  add(line, "span", "row-title", label);
  const amounts = add(line, "span", "forecast-amounts");
  fill(amounts);
  return row;
}

function paintTimeline(months) {
  const root = document.getElementById("proyeccion-timeline");
  if (!root) return;
  clear(root);
  if (months.every((month) => month.totals.ARS === 0 && month.totals.USD === 0) && months[0].serviceDetails.every((service) => !service.text)) {
    add(root, "p", "empty", "Todavía no hay nada para proyectar.");
    return;
  }
  const list = add(root, "ol", "timeline");
  months.forEach((month, index) => {
    const item = add(list, "li", index === 1 ? "is-next" : "");
    add(item, "p", "timeline-month", monthTitle(month.month));
    const total = add(item, "p", "timeline-total");
    total.append(`${money(month.totals.ARS, "ARS")} · `, amountNode(month.totals.USD, "USD"));
    if (index === 1) {
      const delta = monthDelta(months[0], month);
      const change = add(item, "p", "timeline-change");
      paintChange(change, delta);
      if (monthEnding(months[0]).length === 0) {
        add(item, "p", "service-note", "Ninguna cuota ni préstamo termina este mes.");
      } else {
        for (const line of monthEnding(months[0])) item.append(line);
      }
    }
    categoryRow(item, "Tarjeta", (node) => {
      node.append(`${money(month.tarjeta.ARS, "ARS")} · `, amountNode(month.tarjeta.USD, "USD"));
    });
    categoryRow(item, "Préstamos", (node) => {
      node.textContent = money(month.prestamos, "ARS");
    });
    categoryRow(item, "Servicios", (node) => {
      node.textContent = money(month.servicios, "ARS");
    });
    for (const service of month.serviceDetails) {
      if (!service.text && service.amount == null) continue;
      const note = add(item, "p", "service-note");
      const amount = service.amount == null ? "sin proyección" : money(service.amount, "ARS");
      const mark = service.estimated ? "estimado" : "facturado";
      note.textContent = service.amount == null
        ? `${service.name}: ${service.text || "Sin facturas."}`
        : `${service.name}: ${amount}, ${mark}. ${service.text || ""}`.trim();
    }
    categoryRow(item, "Suscripciones", (node) => {
      node.append(`${money(month.suscripciones.ARS, "ARS")} · `, amountNode(month.suscripciones.USD, "USD"));
    });
  });
}

function monthEnding(month) {
  const lines = [];
  for (const item of month.endingCards) {
    const note = document.createElement("p");
    note.className = "service-note";
    note.append(`Termina la cuota de ${item.description} (`, amountNode(Number(item.amount), item.currency === "USD" ? "USD" : "ARS"), ").");
    lines.push(note);
  }
  for (const loan of month.endingLoans) {
    const note = document.createElement("p");
    note.className = "service-note";
    note.textContent = `Termina el préstamo ${loan.name} (${money(Number(loan.installment_amount), "ARS")}).`;
    lines.push(note);
  }
  return lines;
}

function paintUpcoming(data) {
  const root = document.getElementById("upcoming-list");
  if (!root) return;
  root.replaceChildren();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const items = upcomingPayments(data, today);
  if (!items.length) {
    add(root, "p", "empty", "Todavía no hay pagos cargados.");
    return;
  }
  for (const item of items) {
    const row = add(root, "div", "pay-row");
    add(row, "div", "pay-day", item.day || "·");
    const copy = add(row, "div", "pay-copy");
    add(copy, "p", "row-title", item.title);
    add(copy, "p", "row-meta", item.meta);
    const amount = add(row, "p", "row-amount");
    putAmount(amount, item.amount, item.currency);
  }
}

export async function renderProyeccion() {
  const data = await load();
  const months = combinedForecast(data, currentMonth(), 6);
  paintInicio(months, data);
  paintUpcoming(data);
  paintTimeline(months);
}

export function watchProyeccion() {
  onData(() => {
    renderProyeccion();
  });
}
