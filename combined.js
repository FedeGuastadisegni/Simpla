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
  const endingLoans = data.loans.filter((loan) => loanHits(loan, month, reference) > 0 && loanHits(loan, fromMonthKey(monthKey(month.year, month.month) + 1), reference) === 0);
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
