import { listRows, onData } from "./db.js";
import { combinedForecast, monthDelta } from "./combined.js";

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

function changeLine(delta) {
  const parts = [];
  for (const currency of ["ARS", "USD"]) {
    const value = delta[currency];
    if (value === 0) continue;
    const verb = value < 0 ? "Baja" : "Sube";
    parts.push(`${verb} ${money(Math.abs(value), currency)}`);
  }
  return parts.length ? parts.join(" · ") : "Igual que este mes";
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

function paintInicio(months, data) {
  const display = document.getElementById("inicio-total");
  const usd = document.getElementById("inicio-usd");
  const next = document.getElementById("inicio-next");
  if (!display || !usd || !next) return;
  if (!hasAnything(data)) {
    display.textContent = "Sin datos";
    usd.hidden = true;
    next.textContent = "Cuando haya datos, acá vas a ver cómo cambia el mes que viene.";
    return;
  }
  const now = months[0];
  const later = months[1];
  display.textContent = money(now.totals.ARS, "ARS");
  usd.hidden = false;
  usd.textContent = money(now.totals.USD, "USD");
  next.textContent = `El mes que viene ${money(later.totals.ARS, "ARS")} · ${money(later.totals.USD, "USD")}`;
}

function categoryRow(parent, label, text) {
  const row = add(parent, "div", "forecast");
  const line = add(row, "div", "timeline-cat");
  add(line, "span", "row-title", label);
  add(line, "span", "forecast-amounts", text);
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
    add(item, "p", "timeline-total", `${money(month.totals.ARS, "ARS")} · ${money(month.totals.USD, "USD")}`);
    if (index === 1) {
      const delta = monthDelta(months[0], month);
      add(item, "p", "timeline-change", changeLine(delta));
      if (monthEnding(months[0]).length === 0) {
        add(item, "p", "service-note", "Ninguna cuota ni préstamo termina este mes.");
      } else {
        for (const line of monthEnding(months[0])) add(item, "p", "service-note", line);
      }
    }
    categoryRow(item, "Tarjeta", `${money(month.tarjeta.ARS, "ARS")} · ${money(month.tarjeta.USD, "USD")}`);
    categoryRow(item, "Préstamos", money(month.prestamos, "ARS"));
    categoryRow(item, "Servicios", money(month.servicios, "ARS"));
    for (const service of month.serviceDetails) {
      if (!service.text && service.amount == null) continue;
      const note = add(item, "p", "service-note");
      const amount = service.amount == null ? "sin proyección" : money(service.amount, "ARS");
      const mark = service.estimated ? "estimado" : "facturado";
      note.textContent = service.amount == null
        ? `${service.name}: ${service.text || "Sin facturas."}`
        : `${service.name}: ${amount}, ${mark}. ${service.text || ""}`.trim();
    }
    categoryRow(item, "Suscripciones", `${money(month.suscripciones.ARS, "ARS")} · ${money(month.suscripciones.USD, "USD")}`);
  });
}

function monthEnding(month) {
  const lines = [];
  for (const item of month.endingCards) {
    lines.push(`Termina la cuota de ${item.description} (${money(Number(item.amount), item.currency === "USD" ? "USD" : "ARS")}).`);
  }
  for (const loan of month.endingLoans) {
    lines.push(`Termina el préstamo ${loan.name} (${money(Number(loan.installment_amount), "ARS")}).`);
  }
  return lines;
}

export async function renderProyeccion() {
  const data = await load();
  const months = combinedForecast(data, currentMonth(), 6);
  paintInicio(months, data);
  paintTimeline(months);
}

export function watchProyeccion() {
  onData(() => {
    renderProyeccion();
  });
}
