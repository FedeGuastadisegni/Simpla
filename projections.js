// Proyecciones de préstamos, suscripciones y servicios.
// ARS y USD no se suman ni se convierten.
//
// Préstamo: la cuota cae en el mes de referencia y en los
// remaining_installments meses que le siguen, contando ese mes
// como el primero. La fecha de fin se muestra, no recorta la cuenta.
//
// Suscripción mensual: todos los meses desde el mes del próximo cobro.
// Anual: solo ese mes del año, desde el próximo cobro en adelante.
//
// Servicio: el aumento es el promedio de las variaciones entre facturas
// de meses consecutivos, entre las últimas 6. Se aplica en cadena
// desde la última factura. Un mes con factura propia usa ese monto.

import { parseIsoDate } from "./card-math.js";

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

export function loanHits(loan, month, reference) {
  const remaining = Number(loan.remaining_installments);
  const amount = Number(loan.installment_amount);
  if (!Number.isFinite(remaining) || remaining <= 0 || !Number.isFinite(amount)) return 0;
  const offset = monthKey(month.year, month.month) - monthKey(reference.year, reference.month);
  if (offset < 0 || offset >= remaining) return 0;
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

export function subscriptionsInMonth(subscriptions, month) {
  const totals = { ARS: 0, USD: 0 };
  for (const subscription of subscriptions) {
    if (!subscriptionHits(subscription, month)) continue;
    const currency = subscription.currency === "USD" ? "USD" : "ARS";
    totals[currency] += Number(subscription.amount) || 0;
  }
  return totals;
}

function combinedBills(bills) {
  const totals = new Map();
  for (const bill of bills) {
    if (periodKey(bill.period) == null) continue;
    totals.set(bill.period, (totals.get(bill.period) || 0) + (Number(bill.amount) || 0));
  }
  return [...totals.entries()]
    .sort((a, b) => periodKey(a[0]) - periodKey(b[0]))
    .map(([period, amount]) => ({ period, amount }));
}

export function serviceEstimate(bills) {
  const series = combinedBills(bills).slice(-6);
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
  const exact = combinedBills(bills).find((bill) => bill.period === period);
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
