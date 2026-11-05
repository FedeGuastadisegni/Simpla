// Suma el mes con las funciones que ya existen.
// No recalcula cuotas, préstamos, servicios ni suscripciones.
// ARS y USD siguen separados.

import { monthSummary } from "./card-math.js";
import {
  fromMonthKey,
  loanHits,
  loansInMonth,
  monthKey,
  roundMoney,
  serviceAmountInMonth,
  serviceEstimate,
  paidOnCard,
  subscriptionHits,
  subscriptionsInMonth,
} from "./projections.js";

function empty() {
  return { ARS: 0, USD: 0 };
}

function servicesOf(services, bills, month) {
  return services.map((service) => {
    const own = bills.filter((bill) => bill.service_id === service.id);
    const monthAmount = serviceAmountInMonth(own, month);
    const estimate = serviceEstimate(own);
    return {
      id: service.id,
      name: service.name,
      amount: monthAmount.amount,
      estimated: monthAmount.estimated,
      text: estimate.text,
    };
  });
}

export function combinedMonth(data, month, reference) {
  const cards = monthSummary(data.cardItems, data.cards, month);
  const loans = loansInMonth(data.loans, month, reference);
  const subscriptions = subscriptionsInMonth(data.subscriptions, month);
  const services = servicesOf(data.services, data.serviceBills, month);
  const serviceARS = services.reduce((sum, service) => sum + (service.amount || 0), 0);
  const totals = empty();
  totals.ARS = roundMoney(cards.totals.ARS + loans + serviceARS + subscriptions.ARS);
  totals.USD = roundMoney(cards.totals.USD + subscriptions.USD);
  const later = fromMonthKey(monthKey(month.year, month.month) + 1);
  const endingLoans = [];
  for (const loan of data.loans) {
    const now = loanHits(loan, month, reference);
    if (now > 0 && loanHits(loan, later, reference) === 0) endingLoans.push({ ...loan, endingAmount: now });
  }
  return {
    month,
    totals,
    tarjeta: cards.totals,
    prestamos: loans,
    servicios: serviceARS,
    serviceDetails: services,
    suscripciones: subscriptions,
    endingCards: cards.ending,
    endingLoans,
  };
}

export function combinedForecast(data, start, count = 6) {
  const startKey = monthKey(start.year, start.month);
  return Array.from({ length: count }, (_, offset) => combinedMonth(data, fromMonthKey(startKey + offset), start));
}

export function monthDelta(current, next) {
  return {
    ARS: roundMoney(next.totals.ARS - current.totals.ARS),
    USD: roundMoney(next.totals.USD - current.totals.USD),
  };
}

function currencyOf(item) {
  return item.currency === "USD" ? "USD" : "ARS";
}

function noHistory(service) {
  return !service?.text || /falta historial/i.test(service.text);
}

export function nextMonthChange(current, next, subscriptions = []) {
  const ending = [];
  const drop = { ARS: 0, USD: 0 };
  for (const item of current.endingCards || []) {
    const currency = currencyOf(item);
    const amount = Number(item.amount) || 0;
    ending.push({ name: item.description, amount, currency, kind: "cuota" });
    drop[currency] += amount;
  }
  for (const loan of current.endingLoans || []) {
    const amount = Number(loan.endingAmount ?? loan.installment_amount) || 0;
    ending.push({ name: loan.name, amount, currency: "ARS", kind: "prestamo" });
    drop.ARS += amount;
  }
  drop.ARS = roundMoney(drop.ARS);
  drop.USD = roundMoney(drop.USD);

  const nowById = new Map((current.serviceDetails || []).map((service) => [service.id, service]));
  const services = [];
  for (const later of next.serviceDetails || []) {
    const now = nowById.get(later.id);
    const nowAmount = now?.amount ?? null;
    const nextAmount = later.amount ?? null;
    if (nowAmount == null && nextAmount == null) {
      services.push({ id: later.id, name: later.name, kind: "sin-datos", now: null, next: null, text: later.text || "Sin facturas." });
      continue;
    }
    if (noHistory(later)) {
      services.push({ id: later.id, name: later.name, kind: "sin-historial", now: nowAmount, next: nextAmount, text: later.text || "Falta historial para estimar el aumento." });
      continue;
    }
    if (nowAmount != null && nextAmount != null && roundMoney(nextAmount) !== roundMoney(nowAmount)) {
      services.push({
        id: later.id,
        name: later.name,
        kind: nextAmount > nowAmount ? "sube" : "baja",
        now: nowAmount,
        next: nextAmount,
        text: later.text || "",
      });
    }
  }

  const due = (subscriptions || [])
    .filter((subscription) => subscriptionHits(subscription, next.month) && !paidOnCard(subscription))
    .map((subscription) => ({
      name: subscription.name,
      amount: Number(subscription.amount) || 0,
      currency: subscription.currency === "USD" ? "USD" : "ARS",
      frequency: subscription.frequency,
    }));

  const delta = monthDelta(current, next);
  const quiet = ending.length === 0
    && services.length === 0
    && due.length === 0
    && delta.ARS === 0
    && delta.USD === 0;

  return { ending, drop, services, subscriptions: due, delta, quiet };
}
