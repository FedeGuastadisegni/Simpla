// Los compromisos se agrupan por mes de pago. El vencimiento confirmado
// corresponde a la cuota indicada, no a la fecha original de compra.
// Sin vencimiento ni cierre, los datos anteriores mantienen su cálculo
// calendario hasta que se confirme su período al editar o reimportar.
// ARS y USD no se suman ni se convierten.

export function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (new Date(Date.UTC(year, month, 0)).getUTCDate() < day) return null;
  return { year, month: month - 1, day };
}

export function monthKey(year, month) {
  return year * 12 + month;
}

export function fromMonthKey(key) {
  return { year: Math.floor(key / 12), month: key % 12 };
}

export function statementMonth(spentOn, closingDay) {
  const date = parseIsoDate(spentOn);
  if (!date) return null;
  const closing = Number(closingDay);
  const hasClosing = closingDay != null && closingDay !== "" && Number.isInteger(closing) && closing >= 1 && closing <= 31;
  if (!hasClosing || date.day <= closing) return { year: date.year, month: date.month };
  return fromMonthKey(monthKey(date.year, date.month) + 1);
}

function dateInMonth(month, day) {
  const last = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  return `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function purchasePeriod(spentOn, card) {
  if (!parseIsoDate(spentOn)) return null;
  let closing = Number(card?.closing_day);
  let due = Number(card?.due_day);
  if (!Number.isInteger(closing) || closing < 1 || closing > 31
      || !Number.isInteger(due) || due < 1 || due > 31) return null;
  // Los cierres reales pueden moverse de un mes a otro.
  for (const [close, payment] of [
    [card.last_closing_on, card.last_due_on],
    [card.next_closing_on, card.next_due_on],
  ]) {
    const parsedClose = parseIsoDate(close);
    if (!parsedClose || !parseIsoDate(payment)) continue;
    const previous = fromMonthKey(monthKey(parsedClose.year, parsedClose.month) - 1);
    const previousClose = close === card.next_closing_on && card.last_closing_on
      ? card.last_closing_on : dateInMonth(previous, closing);
    if (spentOn > previousClose && spentOn <= close) {
      return { statement_closes_on: close, statement_due_on: payment };
    }
  }
  if (card.next_closing_on && spentOn > card.next_closing_on) {
    closing = parseIsoDate(card.next_closing_on)?.day || closing;
    due = parseIsoDate(card.next_due_on)?.day || due;
  }
  const date = parseIsoDate(spentOn);
  let closeMonth = { year: date.year, month: date.month };
  if (spentOn > dateInMonth(closeMonth, closing)) {
    closeMonth = fromMonthKey(monthKey(date.year, date.month) + 1);
  }
  const payMonth = fromMonthKey(monthKey(closeMonth.year, closeMonth.month) + (due <= closing ? 1 : 0));
  return {
    statement_closes_on: dateInMonth(closeMonth, closing),
    statement_due_on: dateInMonth(payMonth, due),
  };
}

export function nextCardDate(card, todayIso, kind = "due") {
  const today = parseIsoDate(todayIso);
  if (!today) return null;
  const field = kind === "closing" ? "closing" : "due";
  const confirmed = [card[`last_${field}_on`], card[`next_${field}_on`]]
    .filter((date) => parseIsoDate(date) && date >= todayIso).sort();
  if (confirmed.length) return confirmed[0];
  const next = parseIsoDate(card[`next_${field}_on`]);
  const day = next?.day || Number(card[`${field}_day`]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  let month = { year: today.year, month: today.month };
  let date = dateInMonth(month, day);
  if (date < todayIso) {
    month = fromMonthKey(monthKey(today.year, today.month) + 1);
    date = dateInMonth(month, day);
  }
  return date;
}

function currencyOf(item) {
  return item.currency === "USD" ? "USD" : "ARS";
}

function amountOf(item) {
  const amount = Number(item.amount);
  return Number.isFinite(amount) ? amount : 0;
}

function isOnePayment(item) {
  return item.installment_number == null || item.installment_count == null;
}

function rangeFor(item, card) {
  const confirmed = parseIsoDate(item.statement_due_on);
  const estimated = !confirmed && purchasePeriod(item.spent_on, card);
  const start = confirmed || parseIsoDate(estimated?.statement_due_on)
    || statementMonth(item.spent_on, card.closing_day);
  if (!start) return null;
  const anchorKey = monthKey(start.year, start.month);
  if (isOnePayment(item)) return { startKey: anchorKey, endKey: anchorKey, onePayment: true };
  const current = Number(item.installment_number);
  const total = Number(item.installment_count);
  if (!Number.isInteger(current) || !Number.isInteger(total) || total < 1 || current < 1 || current > total) {
    return null;
  }
  return {
    startKey: confirmed ? anchorKey - current + 1 : anchorKey,
    endKey: anchorKey + (total - current),
    anchorKey, current, onePayment: false,
  };
}

export function emptyTotals() {
  return { ARS: 0, USD: 0 };
}

export function monthSummary(items, cards, month) {
  const byCard = new Map(cards.map((card) => [card.id, card]));
  const target = monthKey(month.year, month.month);
  const totals = emptyTotals();
  const charges = [];
  const ending = [];

  for (const item of items) {
    const card = byCard.get(item.card_id);
    if (!card) continue;
    const range = rangeFor(item, card);
    if (!range || target < range.startKey || target > range.endKey) continue;
    const currency = currencyOf(item);
    totals[currency] = Math.round((totals[currency] + amountOf(item)) * 100) / 100;
    const charge = range.onePayment ? item : {
      ...item, installment_number: range.current + target - range.anchorKey,
    };
    charges.push(charge);
    if (!range.onePayment && target === range.endKey) {
      ending.push(charge);
    }
  }

  return { totals, charges, ending };
}

export function sumByCurrency(items) {
  const totals = emptyTotals();
  for (const item of items) {
    const currency = currencyOf(item);
    totals[currency] = Math.round((totals[currency] + amountOf(item)) * 100) / 100;
  }
  return totals;
}

export function forecastMonths(items, cards, start, count = 6) {
  const startKey = monthKey(start.year, start.month);
  return Array.from({ length: count }, (_, offset) => {
    const key = startKey + offset;
    const month = fromMonthKey(key);
    const summary = monthSummary(items, cards, month);
    return { month, totals: summary.totals, ending: summary.ending, charges: summary.charges };
  });
}
