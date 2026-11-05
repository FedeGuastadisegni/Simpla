// Mes del resumen de una compra.
//
// Si la tarjeta tiene día de cierre, una compra con día posterior a ese
// cierre entra en el resumen del mes siguiente. El día del cierre
// inclusive queda en el mes de la fecha. Sin día de cierre, el mes del
// resumen es el mes calendario de `spent_on`: el vencimiento solo no
// alcanza para correr el mes, y esta función no lo usa.
//
// Una compra en un pago impacta solo en ese mes.
// Una compra en cuotas, con cuota actual N de T en el mes M, impacta
// en M, M+1, …, M+(T-N). El monto guardado es el de cada cuota, no el total.
// ARS y USD no se suman ni se convierten.

export function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
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

function rangeFor(item, closingDay) {
  const start = statementMonth(item.spent_on, closingDay);
  if (!start) return null;
  const startKey = monthKey(start.year, start.month);
  if (isOnePayment(item)) return { startKey, endKey: startKey, onePayment: true };
  const current = Number(item.installment_number);
  const total = Number(item.installment_count);
  if (!Number.isInteger(current) || !Number.isInteger(total) || total < 1 || current < 1 || current > total) {
    return null;
  }
  return { startKey, endKey: startKey + (total - current), onePayment: false };
}

export function emptyTotals() {
  return { ARS: 0, USD: 0 };
}

export function monthSummary(items, cards, month) {
  const closingByCard = new Map(cards.map((card) => [card.id, card.closing_day]));
  const target = monthKey(month.year, month.month);
  const totals = emptyTotals();
  const charges = [];
  const ending = [];

  for (const item of items) {
    const range = rangeFor(item, closingByCard.get(item.card_id));
    if (!range || target < range.startKey || target > range.endKey) continue;
    const currency = currencyOf(item);
    totals[currency] += amountOf(item);
    charges.push(item);
    if (!range.onePayment && Number(item.installment_number) === Number(item.installment_count)) {
      ending.push(item);
    }
  }

  return { totals, charges, ending };
}

export function sumByCurrency(items) {
  const totals = emptyTotals();
  for (const item of items) {
    totals[currencyOf(item)] += amountOf(item);
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
