import { nextCardDate, parseIsoDate, monthSummary, fromMonthKey, monthKey, sumByCurrency } from './card-math.js';
import { withCardEstimates } from './recurring.js';

export function chargeKind(item) {
  if (item.subscription_id || String(item.id).startsWith('estimate:subscription:')) return 'Suscripciones';
  if (item.service_bill_id || String(item.id).startsWith('estimate:service:')) return 'Servicios';
  return Number(item.installment_count) > 1 ? 'Cuotas' : 'Compras puntuales';
}

export function cardDashboard(data, card, today) {
  const due = nextCardDate(card, today);
  if (!due) return null;
  const month = parseIsoDate(due);
  const items = withCardEstimates(data, month, 2);
  const current = monthSummary(items, [card], month);
  const next = monthSummary(items, [card], fromMonthKey(monthKey(month.year, month.month) + 1));
  const groups = Object.fromEntries(['Cuotas', 'Compras puntuales', 'Suscripciones', 'Servicios'].map(kind =>
    [kind, sumByCurrency(current.charges.filter(item => chargeKind(item) === kind))]));
  const ending = sumByCurrency(current.ending.filter(item => chargeKind(item) === 'Cuotas'));
  const oneOff = groups['Compras puntuales'];
  const delta = Object.fromEntries(['ARS', 'USD'].map(currency => [currency,
    Math.round((next.totals[currency] - current.totals[currency]) * 100) / 100]));
  const other = Object.fromEntries(['ARS', 'USD'].map(currency => [currency,
    Math.round((delta[currency] + ending[currency] + oneOff[currency]) * 100) / 100]));
  return { due, current, next, groups, ending, oneOff, delta, other,
    estimated: sumByCurrency(current.charges.filter(item => item.estimated || !item.statement_due_on)) };
}

export function dailySummary(expenses, period) {
  const rows = expenses.filter(row => row.spent_on?.slice(0, 7) === period)
    .sort((a, b) => b.spent_on.localeCompare(a.spent_on));
  const categories = [...new Set(rows.map(row => row.category || 'Sin categoría'))]
    .map(name => ({ name, totals: sumByCurrency(rows.filter(row => (row.category || 'Sin categoría') === name)) }));
  return { rows, categories, totals: sumByCurrency(rows) };
}
