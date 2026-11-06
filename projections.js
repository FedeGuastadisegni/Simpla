// Proyecciones de préstamos, suscripciones y servicios.
// ARS y USD no se suman ni se convierten.
//
// Préstamo de cuota fija: el mismo monto cae en el mes de referencia
// y en los remaining_installments meses que le siguen, contando ese
// mes como el primero. La fecha de fin se muestra, no recorta la cuenta.
//
// Sistema alemán: la amortización es el capital restante dividido las
// cuotas restantes, y es fija. La cuota k es amortización + interés,
// y el interés es el saldo × TEM. El saldo baja en la amortización.
// La TEM está en porcentaje (5 es 5%). La CFT no entra en la cuenta.
// Si la cuota del banco difiere, esa diferencia se suma a cada cuota
// solo cuando adjust_bank está prendido.
//
// Suscripción mensual: todos los meses desde el mes del próximo cobro.
// Anual: solo ese mes del año, desde el próximo cobro en adelante.
//
// Servicio: el aumento es el promedio de las variaciones entre facturas
// de meses consecutivos, entre las últimas 6. Se aplica en cadena
// desde la última factura. Un mes con factura propia usa ese monto.

import { monthSummary, nextCardDate, parseIsoDate } from "./card-math.js";

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function monthKey(year, month) {
  return year * 12 + month;
}

export function fromMonthKey(key) {
  return { year: Math.floor(key / 12), month: ((key % 12) + 12) % 12 };
}

export function periodKey(period) {
  const date = parseIsoDate(`${period}-01`);
  if (!date) return null;
  return monthKey(date.year, date.month);
}

export function formatPercent(rate) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(rate * 100);
}

export const BANK_GAP_NOTE = "puede incluir IVA sobre intereses o seguro";

export function germanSchedule(loan) {
  const count = Number(loan.remaining_installments);
  const principal = Number(loan.remaining_principal);
  const tem = Number(loan.tem);
  if (!Number.isInteger(count) || count <= 0) return [];
  if (!Number.isFinite(principal) || principal < 0) return [];
  if (!Number.isFinite(tem) || tem < 0) return [];
  const rate = tem / 100;
  const fixed = roundMoney(principal / count);
  let balance = roundMoney(principal);
  const rows = [];
  for (let number = 1; number <= count; number += 1) {
    const amortization = number === count ? balance : fixed;
    const interest = roundMoney(balance * rate);
    rows.push({
      number,
      amortization,
      interest,
      installment: roundMoney(amortization + interest),
      balance,
    });
    balance = roundMoney(balance - amortization);
  }
  return rows;
}

export function bankDifference(loan) {
  if (loan.amortization !== "aleman") return null;
  if (loan.current_installment_bank == null || loan.current_installment_bank === "") return null;
  const bank = Number(loan.current_installment_bank);
  if (!Number.isFinite(bank)) return null;
  const schedule = germanSchedule(loan);
  if (schedule.length === 0) return null;
  const gap = roundMoney(bank - schedule[0].installment);
  if (gap === 0) return null;
  return { bank, calculated: schedule[0].installment, gap };
}

function germanInstallment(loan, offset) {
  const row = germanSchedule(loan)[offset];
  if (!row) return 0;
  if (!loan.adjust_bank) return row.installment;
  return roundMoney(row.installment + (bankDifference(loan)?.gap || 0));
}

export function loanHits(loan, month, reference) {
  const remaining = Number(loan.remaining_installments);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  const offset = monthKey(month.year, month.month) - monthKey(reference.year, reference.month);
  if (offset < 0 || offset >= remaining) return 0;
  if (loan.amortization === "aleman") return germanInstallment(loan, offset);
  const amount = Number(loan.installment_amount);
  if (!Number.isFinite(amount)) return 0;
  return amount;
}

export function loansInMonth(loans, month, reference) {
  return loans.reduce((sum, loan) => sum + loanHits(loan, month, reference), 0);
}

export function subscriptionHits(subscription, month) {
  const next = parseIsoDate(subscription.next_charge_on);
  if (!next) return false;
  const target = monthKey(month.year, month.month);
  const start = monthKey(next.year, next.month);
  if (target < start) return false;
  if (subscription.frequency === "anual") return month.month === next.month;
  return subscription.frequency === "mensual";
}

// Cobro que ya entra en el resumen de la tarjeta. Se sigue para el próximo
// vencimiento, pero no se suma a los fijos ni a la proyección.
export function paidOnCard(subscription) {
  return subscription?.on_card === true;
}

export function subscriptionsInMonth(subscriptions, month, options = {}) {
  const includeOnCard = options.includeOnCard === true;
  const totals = { ARS: 0, USD: 0 };
  for (const subscription of subscriptions) {
    if (!includeOnCard && paidOnCard(subscription)) continue;
    if (!subscriptionHits(subscription, month)) continue;
    const currency = subscription.currency === "USD" ? "USD" : "ARS";
    totals[currency] += Number(subscription.amount) || 0;
  }
  return totals;
}

function billsByPeriod(bills) {
  const chosen = new Map();
  bills.forEach((bill, index) => {
    if (periodKey(bill.period) == null) return;
    const previous = chosen.get(bill.period);
    const stamp = String(bill.created_at || "");
    const previousStamp = previous ? String(previous.bill.created_at || "") : "";
    if (!previous || stamp > previousStamp || (stamp === previousStamp && index > previous.index)) {
      chosen.set(bill.period, { bill, index });
    }
  });
  return [...chosen.values()]
    .map(({ bill }) => ({ period: bill.period, amount: Number(bill.amount) || 0 }))
    .sort((a, b) => periodKey(a.period) - periodKey(b.period));
}

export function duplicateBill(bills, serviceId, period, editingId) {
  return bills.find((row) => row.service_id === serviceId && row.period === period && row.id !== editingId) || null;
}

export function serviceEstimate(bills) {
  const series = billsByPeriod(bills).slice(-6);
  if (series.length === 0) {
    return { rate: null, billCount: 0, gaps: false, flat: false, text: null, last: null };
  }
  if (series.length === 1) {
    return {
      rate: null,
      billCount: 1,
      gaps: false,
      flat: true,
      text: "Falta historial para estimar el aumento.",
      last: series[0],
    };
  }

  const changes = [];
  let gaps = false;
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    if (periodKey(current.period) - periodKey(previous.period) !== 1) {
      gaps = true;
      continue;
    }
    if (previous.amount === 0) continue;
    changes.push((current.amount - previous.amount) / previous.amount);
  }

  const last = series[series.length - 1];
  if (changes.length === 0) {
    const gapText = gaps ? "Hay meses sin factura y " : "";
    return {
      rate: null,
      billCount: series.length,
      gaps,
      flat: true,
      text: `${gapText}falta historial para estimar el aumento.`.replace(/^f/, "F"),
      last,
    };
  }

  const raw = changes.reduce((sum, change) => sum + change, 0) / changes.length;
  const rate = Math.round(raw * 1e10) / 1e10;
  const percent = formatPercent(rate);
  const average = `Aumento promedio de las últimas ${series.length} facturas: ${percent}% por mes.`;
  const text = gaps
    ? `Hay meses sin factura: el promedio usa solo los meses consecutivos. ${average}`
    : average;
  return { rate, billCount: series.length, gaps, flat: false, text, last };
}

export function serviceAmountInMonth(bills, month) {
  const estimate = serviceEstimate(bills);
  if (!estimate.last) return { amount: null, estimated: false, estimate };
  const period = `${month.year}-${String(month.month + 1).padStart(2, "0")}`;
  const exact = billsByPeriod(bills).find((bill) => bill.period === period);
  if (exact) return { amount: exact.amount, estimated: false, estimate };
  const target = monthKey(month.year, month.month);
  const lastKey = periodKey(estimate.last.period);
  if (target < lastKey) return { amount: null, estimated: false, estimate };
  const steps = target - lastKey;
  if (estimate.rate == null) {
    return { amount: estimate.last.amount, estimated: true, estimate };
  }
  let amount = estimate.last.amount;
  for (let step = 0; step < steps; step += 1) {
    amount = roundMoney(amount * (1 + estimate.rate));
  }
  return { amount, estimated: true, estimate };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoOf(parts) {
  const last = new Date(parts.year, parts.month + 1, 0).getDate();
  const day = Math.min(Math.max(1, Number(parts.day) || 1), last);
  return `${parts.year}-${pad(parts.month + 1)}-${pad(day)}`;
}

function shiftParts(parts, count) {
  const next = fromMonthKey(monthKey(parts.year, parts.month) + count);
  return { year: next.year, month: next.month, day: parts.day };
}

function withinDays(fromIso, toIso, days) {
  const start = parseIsoDate(fromIso);
  const end = parseIsoDate(toIso);
  if (!start || !end) return false;
  const diff = (Date.UTC(end.year, end.month, end.day) - Date.UTC(start.year, start.month, start.day)) / 86400000;
  return diff >= 0 && diff <= days;
}

export function nextSubscriptionDate(subscription, todayIso) {
  const parts = nextCharge(subscription, todayIso);
  return parts ? isoOf(parts) : null;
}

function nextCharge(subscription, todayIso) {
  const start = parseIsoDate(subscription.next_charge_on);
  if (!start) return null;
  const step = subscription.frequency === "anual" ? 12 : subscription.frequency === "mensual" ? 1 : 0;
  if (!step) return null;
  let cursor = start;
  for (let guard = 0; isoOf(cursor) < todayIso && guard < 240; guard += 1) {
    cursor = shiftParts(cursor, step);
  }
  return cursor;
}

export function upcomingPayments(data, todayIso) {
  const today = parseIsoDate(todayIso);
  if (!today) return [];
  const month = { year: today.year, month: today.month };
  const items = [];

  for (const subscription of data.subscriptions || []) {
    const date = nextSubscriptionDate(subscription, todayIso);
    if (!date) continue;
    const next = parseIsoDate(date);
    if (!withinDays(todayIso, date, 45)) continue;
    items.push({
      date,
      day: pad(next.day),
      title: subscription.name,
      meta: [
        subscription.frequency === "anual" ? "Suscripción anual" : "Suscripción",
        paidOnCard(subscription) ? "en tarjeta" : "",
      ].filter(Boolean).join(" · "),
      amount: Number(subscription.amount) || 0,
      currency: subscription.currency === "USD" ? "USD" : "ARS",
    });
  }

  for (const card of data.cards || []) {
    const date = nextCardDate(card, todayIso);
    const pay = parseIsoDate(date);
    if (!pay) continue;
    if (!withinDays(todayIso, date, 45)) continue;
    const summary = monthSummary(data.cardItems || [], [card], { year: pay.year, month: pay.month });
    if (summary.totals.ARS > 0) {
      items.push({
        date,
        day: pad(pay.day),
        title: card.name,
        meta: "Tarjeta",
        amount: summary.totals.ARS,
        currency: "ARS",
      });
    }
    if (summary.totals.USD > 0) {
      items.push({
        date,
        day: pad(pay.day),
        title: card.name,
        meta: "Tarjeta · dólares",
        amount: summary.totals.USD,
        currency: "USD",
      });
    }
  }

  for (const loan of data.loans || []) {
    const amount = loanHits(loan, month, month);
    if (!(amount > 0)) continue;
    items.push({
      date: null,
      day: null,
      title: loan.name,
      meta: "Préstamo · cuota de este mes",
      amount,
      currency: "ARS",
    });
  }

  for (const service of data.services || []) {
    const own = (data.serviceBills || []).filter((bill) => bill.service_id === service.id);
    const result = serviceAmountInMonth(own, month);
    if (!(result.amount > 0)) continue;
    items.push({
      date: null,
      day: null,
      title: service.name,
      meta: result.estimated ? "Servicio · estimado" : "Servicio · facturado",
      amount: result.amount,
      currency: "ARS",
    });
  }

  items.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.date !== b.date) return a.date ? -1 : 1;
    return String(a.title).localeCompare(String(b.title), "es");
  });
  return items;
}
