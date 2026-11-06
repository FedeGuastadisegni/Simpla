// Cargos calculados en memoria. Nunca se guardan como consumos confirmados.
import { fromMonthKey, monthKey, parseIsoDate, purchasePeriod } from "./card-math.js";
import { serviceAmountInMonth, upcomingPayments } from "./projections.js";

export function shiftChargeDate(iso, offset, day) {
  const date = parseIsoDate(iso);
  if (!date) return null;
  const month = fromMonthKey(monthKey(date.year, date.month) + offset);
  const last = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  return `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(Math.min(day || date.day, last)).padStart(2, "0")}`;
}

export function chargeDay(iso, history = []) {
  const date = parseIsoDate(iso);
  if (!date) return null;
  const last = new Date(Date.UTC(date.year, date.month + 1, 0)).getUTCDate();
  return date.day === last ? Math.max(date.day, ...history.map((item) => parseIsoDate(item.spent_on)?.day || 0)) : date.day;
}

export function latestCharge(items) {
  return [...items].sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on))
    || String(b.statement_due_on || "").localeCompare(String(a.statement_due_on || "")))[0];
}

export function withCardEstimates(data, start, count = 6) {
  const real = data.cardItems || [];
  const result = [...real];
  const first = monthKey(start.year, start.month);
  const end = first + count - 1;
  const cards = new Map((data.cards || []).map((card) => [card.id, card]));
  function include(entity, spentOn, amount, currency, confirmed, id) {
    const card = cards.get(entity.card_id);
    if (!card || confirmed) return;
    const period = purchasePeriod(spentOn, card);
    const due = parseIsoDate(period?.statement_due_on);
    if (!due) return;
    const target = monthKey(due.year, due.month);
    if (target < first || target > end || !Number.isFinite(amount) || amount < 0) return;
    result.push({
      id, card_id: card.id, description: entity.name, spent_on: spentOn, amount, currency,
      installment_number: null, installment_count: null, ...period, estimated: true,
    });
  }
  for (const subscription of data.subscriptions || []) {
    if (!subscription.on_card || !subscription.card_id) continue;
    const base = parseIsoDate(subscription.next_charge_on);
    const step = subscription.frequency === "anual" ? 12 : subscription.frequency === "mensual" ? 1 : 0;
    if (!base || !step) continue;
    const history = real.filter((item) => item.subscription_id === subscription.id);
    const source = latestCharge(history);
    const nominal = source && chargeDay(source.spent_on, history);
    const day = source && subscription.next_charge_on === shiftChargeDate(source.spent_on, step, nominal) ? nominal : base.day;
    // Incluye cargos previos al inicio cuyo vencimiento cae dentro del horizonte.
    const offset = Math.max(0, Math.floor((first - monthKey(base.year, base.month) - 2) / step) * step);
    for (let delta = offset; monthKey(base.year, base.month) + delta <= end; delta += step) {
      const spentOn = shiftChargeDate(subscription.next_charge_on, delta, day);
      const period = purchasePeriod(spentOn, cards.get(subscription.card_id));
      const confirmed = real.some((item) => item.subscription_id === subscription.id
        && (item.spent_on.slice(0, 7) === spentOn.slice(0, 7)
          || (period && item.statement_due_on?.slice(0, 7) === period.statement_due_on.slice(0, 7))));
      include(subscription, spentOn, Number(subscription.amount), subscription.currency, confirmed,
        `estimate:subscription:${subscription.id}:${spentOn}`);
    }
  }
  for (const service of data.services || []) {
    if (!service.card_id) continue;
    const own = (data.serviceBills || []).filter((bill) => bill.service_id === service.id);
    const ids = new Set(own.map((bill) => bill.id));
    const linked = real.filter((item) => ids.has(item.service_bill_id));
    const source = latestCharge(linked);
    const bill = source ? own.find((row) => row.id === source.service_bill_id)
      : [...own].sort((a, b) => b.period.localeCompare(a.period))[0];
    const baseDate = source?.spent_on || (bill && `${bill.period}-01`);
    const base = parseIsoDate(baseDate);
    const basePeriod = bill && parseIsoDate(`${bill.period}-01`);
    if (!base || !basePeriod) continue;
    const offset = Math.max(source ? 1 : 0, first - monthKey(base.year, base.month) - 2);
    for (let delta = offset; monthKey(base.year, base.month) + delta <= end; delta += 1) {
      const spentOn = shiftChargeDate(baseDate, delta, chargeDay(baseDate, linked));
      const period = shiftChargeDate(`${bill.period}-01`, delta).slice(0, 7);
      const target = parseIsoDate(`${period}-01`);
      const actualIds = new Set(own.filter((row) => row.period === period).map((row) => row.id));
      const confirmed = real.some((item) => actualIds.has(item.service_bill_id));
      const amount = serviceAmountInMonth(own, target).amount;
      include(service, spentOn, amount, "ARS", confirmed, `estimate:service:${service.id}:${period}`);
    }
  }
  return result;
}

export function upcomingClassifiedPayments(data, todayIso) {
  const start = parseIsoDate(todayIso);
  if (!start) return [];
  return upcomingPayments({
    ...data, cardItems: withCardEstimates(data, start, 3),
    subscriptions: (data.subscriptions || []).filter((row) => !row.on_card),
    services: (data.services || []).filter((row) => !row.card_id),
  }, todayIso);
}
