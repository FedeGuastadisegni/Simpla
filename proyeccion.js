import { listRows, onData } from "./db.js";
import { amountNode, putAmount } from "./money-view.js";
import { combinedForecast, monthDelta, nextMonthChange } from "./combined.js";
import { roundMoney, upcomingPayments } from "./projections.js";

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

const NS = "http://www.w3.org/2000/svg";

const CATS = [
  { key: "tarjeta", label: "Tarjeta", slice: "--slice-1", value: (month) => Number(month.tarjeta?.ARS) || 0, meta: (data) => cuenta(data.cardItems.length, "consumo", "consumos") },
  { key: "prestamos", label: "Préstamos", slice: "--slice-2", value: (month) => Number(month.prestamos) || 0, meta: (data) => cuenta(data.loans.length, "préstamo", "préstamos") },
  { key: "servicios", label: "Servicios", slice: "--slice-3", value: (month) => Number(month.servicios) || 0, meta: (data) => cuenta(data.services.length, "servicio", "servicios") },
  { key: "suscripciones", label: "Suscripciones", slice: "--slice-4", value: (month) => Number(month.suscripciones?.ARS) || 0, meta: (data) => cuenta(data.subscriptions.length, "suscripción", "suscripciones") },
];

function cuenta(count, one, many) {
  const total = Number(count) || 0;
  if (total <= 0) return "";
  return total === 1 ? `1 ${one}` : `${total} ${many}`;
}

function wholePercents(parts, total) {
  const raw = parts.map((part) => (part.value / total) * 100);
  const floors = raw.map((value) => Math.floor(value));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - floors[index] }))
    .sort((a, b) => b.frac - a.frac);
  for (const item of order) {
    if (left <= 0) break;
    floors[item.index] += 1;
    left -= 1;
  }
  return floors;
}

function paintRing(month) {
  const ring = document.getElementById("inicio-ring");
  const svg = document.getElementById("inicio-ring-svg");
  const legend = document.getElementById("inicio-legend");
  if (!ring || !svg || !legend) return;
  svg.replaceChildren();
  legend.replaceChildren();
  const parts = month ? CATS.map((cat) => ({ ...cat, value: cat.value(month) })).filter((part) => part.value > 0) : [];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0) {
    ring.hidden = true;
    return;
  }
  const radius = 46;
  const length = 2 * Math.PI * radius;
  const gap = parts.length > 1 ? Math.min(14, length / parts.length / 5) : 0;
  const track = document.createElementNS(NS, "circle");
  track.setAttribute("class", "ring-track");
  track.setAttribute("cx", "60");
  track.setAttribute("cy", "60");
  track.setAttribute("r", String(radius));
  svg.append(track);
  const percents = wholePercents(parts, total);
  let cursor = 0;
  parts.forEach((part, index) => {
    const full = (part.value / total) * length;
    const dash = Math.max(full - gap, 1);
    const arc = document.createElementNS(NS, "circle");
    arc.setAttribute("class", "ring-arc");
    arc.setAttribute("cx", "60");
    arc.setAttribute("cy", "60");
    arc.setAttribute("r", String(radius));
    arc.setAttribute("transform", "rotate(-90 60 60)");
    arc.style.stroke = `var(${part.slice})`;
    arc.style.strokeDasharray = `${dash.toFixed(2)} ${length.toFixed(2)}`;
    arc.style.strokeDashoffset = (-(cursor + gap / 2)).toFixed(2);
    svg.append(arc);
    cursor += full;
    const item = document.createElement("li");
    const dot = document.createElement("i");
    dot.style.background = `var(${part.slice})`;
    item.append(dot, document.createTextNode(`${percents[index]}% ${part.label}`));
    legend.append(item);
  });
  ring.hidden = false;
}

function paintCats(month, data) {
  const values = CATS.map((cat) => ({ ...cat, value: month ? cat.value(month) : 0 }));
  const max = values.reduce((peak, cat) => Math.max(peak, cat.value), 0);
  for (const cat of values) {
    const row = document.querySelector(`[data-cat="${cat.key}"]`);
    if (!row) continue;
    const share = max > 0 ? cat.value / max : 0;
    row.style.setProperty("--share", share.toFixed(3));
    row.classList.toggle("is-empty", share <= 0);
    const meta = row.querySelector(".cat-meta");
    if (meta) meta.textContent = data ? cat.meta(data) : "";
  }
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
    next.hidden = true;
    paintRing(null);
    paintCats(null, null);
    paintBars(months, false);
    return;
  }
  const now = months[0];
  display.textContent = money(now.totals.ARS, "ARS");
  usd.hidden = false;
  putAmount(usd, now.totals.USD, "USD");
  next.hidden = false;
  next.textContent = "Ver cambios y sugerencias";
  paintRing(now);
  paintCats(now, data);
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

const CHANGE_ICONS = {
  calendar: "M7 4v2.5M17 4v2.5M4.5 9h15M6 6.5h12a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5Z",
  trend: "M4 16l5-5 3 3 7-8M14 6h5v5",
  refresh: "M20 12a8 8 0 1 1-2.3-5.6M20 4.5V10H14.5",
};

function paintAmount(parent, amount, currency) {
  parent.append(amountNode(amount, currency));
}

function changeIcon(name) {
  const span = document.createElement("span");
  span.className = "change-ico";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", CHANGE_ICONS[name] || CHANGE_ICONS.calendar);
  svg.append(path);
  span.append(svg);
  return span;
}

function signedPercent(now, next) {
  if (!now) return "";
  const pct = ((next - now) / now) * 100;
  const abs = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(Math.abs(pct));
  return `${pct < 0 ? "−" : "+"}${abs}%`;
}

function changeRow(parent, spec) {
  const row = add(parent, "div", "change-row");
  row.append(changeIcon(spec.icon));
  const copy = add(row, "div", "change-copy");
  add(copy, "p", "row-title", spec.title);
  if (spec.meta) add(copy, "p", "row-meta", spec.meta);
  if (spec.note) add(copy, "p", "row-meta", spec.note);
  if (spec.amount == null) return row;
  const tone = spec.tone === "down" ? "is-down" : spec.tone === "up" ? "is-up" : "";
  const pill = add(row, "span", tone ? `delta-pill ${tone}` : "delta-pill");
  if (spec.tone === "down") pill.append("−");
  else if (spec.tone === "up") pill.append("+");
  paintAmount(pill, Math.abs(spec.amount), spec.currency || "ARS");
  return row;
}

function paintNextChange(months, data) {
  const root = document.getElementById("next-change-body");
  if (!root) return;
  root.replaceChildren();
  if (!months || months.length < 2) {
    add(root, "p", "empty", "Sin cambios fuertes el mes que viene.");
    return;
  }
  const change = nextMonthChange(months[0], months[1], data.subscriptions);
  const nothingLoaded = months.every((month) => month.totals.ARS === 0 && month.totals.USD === 0);
  if (change.quiet && nothingLoaded) {
    add(root, "p", "empty", "Cuando haya datos, acá vas a ver cómo cambia el mes que viene.");
    return;
  }
  if (change.quiet) {
    add(root, "p", "empty", "Sin cambios fuertes el mes que viene.");
    return;
  }

  for (const item of change.ending) {
    changeRow(root, {
      icon: "calendar",
      title: item.kind === "prestamo" ? "Préstamo termina" : "Cuota termina",
      meta: item.name,
      amount: item.amount,
      currency: item.currency,
      tone: "down",
    });
  }
  if (change.ending.length > 1 && (change.drop.ARS > 0 || change.drop.USD > 0)) {
    const drop = add(root, "p", "service-note");
    drop.append("Por estas cuotas, el mes que viene baja ");
    const parts = [];
    if (change.drop.ARS > 0) parts.push(["ARS", change.drop.ARS]);
    if (change.drop.USD > 0) parts.push(["USD", change.drop.USD]);
    parts.forEach(([currency, amount], index) => {
      if (index > 0) drop.append(" y ");
      paintAmount(drop, amount, currency);
    });
    drop.append(".");
  }

  for (const service of change.services) {
    if (service.kind === "sin-datos") {
      changeRow(root, { icon: "trend", title: service.name, meta: service.text });
      continue;
    }
    if (service.kind === "sin-historial") {
      changeRow(root, {
        icon: "trend",
        title: service.name,
        meta: service.text,
        amount: service.next,
        currency: "ARS",
        tone: "flat",
      });
      continue;
    }
    const delta = roundMoney(service.next - service.now);
    const pct = signedPercent(service.now, service.next);
    changeRow(root, {
      icon: "trend",
      title: service.kind === "baja" ? "Servicio baja" : "Servicio sube",
      meta: [service.name, pct].filter(Boolean).join(" · "),
      note: service.text,
      amount: delta,
      currency: "ARS",
      tone: delta < 0 ? "down" : "up",
    });
  }

  const pesos = change.subscriptions.filter((item) => item.currency === "ARS");
  const dolares = change.subscriptions.filter((item) => item.currency === "USD");
  for (const item of [...pesos, ...dolares]) {
    changeRow(root, {
      icon: "refresh",
      title: item.name,
      meta: item.frequency === "anual" ? "Anual" : "Mensual",
      amount: item.amount,
      currency: item.currency,
      tone: "flat",
    });
  }

  const net = add(root, "p", "change-net");
  if (change.delta.ARS === 0 && change.delta.USD === 0) {
    net.textContent = "El mes que viene queda igual.";
  } else {
    if (change.delta.ARS < 0) {
      net.append("El mes que viene baja aprox. ");
      paintAmount(net, Math.abs(change.delta.ARS), "ARS");
      net.append(".");
    } else if (change.delta.ARS > 0) {
      net.append("El mes que viene sube aprox. ");
      paintAmount(net, change.delta.ARS, "ARS");
      net.append(".");
    } else {
      net.append("En pesos queda igual.");
    }
    if (change.delta.USD !== 0) {
      net.append(change.delta.USD < 0 ? " En dólares baja " : " En dólares sube ");
      paintAmount(net, Math.abs(change.delta.USD), "USD");
      net.append(".");
    }
  }
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
  paintNextChange(months, data);
  paintTimeline(months);
}

export function watchProyeccion() {
  onData(() => {
    renderProyeccion();
  });
}
