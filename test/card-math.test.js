import assert from "node:assert/strict";
import test from "node:test";
import { forecastMonths, monthSummary, parseIsoDate, purchasePeriod, statementMonth, sumByCurrency } from "../card-math.js";

// EJEMPLO. No son datos reales ni se cargan en Supabase.
const MONTH = { year: 2026, month: 10 }; // noviembre 2026
const CARD = { id: "card-ejemplo", due_day: 10 };
const DATE = "2026-11-15";

const EXAMPLE = [
  {
    id: "heladera",
    card_id: CARD.id,
    description: "Heladera",
    amount: 100000,
    currency: "ARS",
    spent_on: DATE,
    installment_number: 12,
    installment_count: 12,
  },
  {
    id: "zapatillas",
    card_id: CARD.id,
    description: "Zapatillas",
    amount: 30000,
    currency: "ARS",
    spent_on: DATE,
    installment_number: 3,
    installment_count: 3,
  },
  {
    id: "en-curso",
    card_id: CARD.id,
    description: "Cuota en curso",
    amount: 50000,
    currency: "ARS",
    spent_on: DATE,
    installment_number: 2,
    installment_count: 6,
  },
  {
    id: "usd",
    card_id: CARD.id,
    description: "Consumo en dólares",
    amount: 20,
    currency: "USD",
    spent_on: DATE,
    installment_number: null,
    installment_count: null,
  },
];

test("EJEMPLO: este mes ARS 180.000 y USD 20, separados", () => {
  const summary = monthSummary(EXAMPLE, [CARD], MONTH);
  assert.equal(summary.totals.ARS, 180000);
  assert.equal(summary.totals.USD, 20);
  assert.notEqual(summary.totals.ARS + summary.totals.USD, summary.totals.ARS);
});

test("EJEMPLO: el mes que viene baja ARS 130.000 y el siguiente queda en 50.000", () => {
  const current = monthSummary(EXAMPLE, [CARD], MONTH);
  const drop = sumByCurrency(current.ending);
  assert.equal(drop.ARS, 130000);
  assert.equal(drop.USD, 0);
  assert.deepEqual(
    current.ending.map((item) => item.description).sort(),
    ["Heladera", "Zapatillas"]
  );

  const months = forecastMonths(EXAMPLE, [CARD], MONTH, 6);
  assert.equal(months[1].totals.ARS, 50000);
  assert.equal(months[1].totals.USD, 0);
  assert.equal(months[4].totals.ARS, 50000);
  assert.equal(months[5].totals.ARS, 0);
  assert.equal(months[5].totals.USD, 0);
});

test("un pago impacta solo en el mes de la fecha", () => {
  const item = {
    id: "unico",
    card_id: CARD.id,
    amount: 10,
    currency: "ARS",
    spent_on: "2026-11-02",
    installment_number: null,
    installment_count: null,
  };
  assert.equal(monthSummary([item], [CARD], MONTH).totals.ARS, 10);
  assert.equal(monthSummary([item], [CARD], { year: 2026, month: 11 }).totals.ARS, 0);
});

test("sin día de cierre, el mes del resumen es el de la fecha aunque el vencimiento ya haya pasado", () => {
  const card = { id: CARD.id, due_day: 5 };
  const item = {
    card_id: CARD.id,
    amount: 10,
    currency: "ARS",
    spent_on: "2026-11-20",
    installment_number: null,
    installment_count: null,
  };
  assert.equal(monthSummary([item], [card], MONTH).totals.ARS, 10);
  assert.deepEqual(statementMonth("2026-11-20", null), { year: 2026, month: 10 });
  assert.deepEqual(statementMonth("2026-11-20"), { year: 2026, month: 10 });
  assert.equal(statementMonth("no-es-fecha", 15), null);
});

test("con día de cierre, un gasto posterior cae en el resumen siguiente", () => {
  assert.deepEqual(statementMonth("2026-10-15", 15), { year: 2026, month: 9 });
  assert.deepEqual(statementMonth("2026-10-16", 15), { year: 2026, month: 10 });
  assert.deepEqual(statementMonth("2026-12-20", 15), { year: 2027, month: 0 });
  const card = { id: CARD.id, due_day: 1, closing_day: 15 };
  const before = {
    card_id: CARD.id,
    amount: 10,
    currency: "ARS",
    spent_on: "2026-10-15",
    installment_number: null,
    installment_count: null,
  };
  const after = { ...before, amount: 7, spent_on: "2026-10-16" };
  assert.equal(monthSummary([before, after], [card], { year: 2026, month: 9 }).totals.ARS, 0);
  assert.equal(monthSummary([before, after], [card], { year: 2026, month: 10 }).totals.ARS, 10);
  assert.equal(monthSummary([before, after], [card], { year: 2026, month: 11 }).totals.ARS, 7);
});

test("cierre de octubre y vencimiento de noviembre conserva la cuota informada", () => {
  const card = { id: CARD.id, closing_day: 29, due_day: 11 };
  const item = {
    card_id: CARD.id, amount: 100, currency: "ARS", spent_on: "2026-02-10",
    installment_number: 9, installment_count: 18,
    statement_closes_on: "2026-10-29", statement_due_on: "2026-11-11",
  };
  const november = monthSummary([item], [card], MONTH);
  assert.equal(november.totals.ARS, 100);
  assert.equal(november.charges[0].installment_number, 9);
  const months = forecastMonths([item], [card], MONTH, 11);
  assert.equal(months[8].charges[0].installment_number, 17);
  assert.equal(months[9].ending[0].installment_number, 18);
  assert.equal(months[10].totals.ARS, 0);
});

test("una cuota 2/3 termina al mes siguiente y libera el importe", () => {
  const item = {
    card_id: CARD.id, amount: 100, currency: "ARS", spent_on: "2026-10-05",
    installment_number: 2, installment_count: 3, statement_due_on: "2026-11-11",
  };
  const months = forecastMonths([item], [CARD], MONTH, 3);
  assert.equal(months[0].ending.length, 0);
  assert.equal(months[1].ending[0].installment_number, 3);
  assert.equal(sumByCurrency(months[1].ending).ARS, 100);
  assert.equal(months[2].totals.ARS, 0);
});

test("una compra en un pago se paga al vencer y no se repite", () => {
  const item = {
    card_id: CARD.id, amount: 20, currency: "USD", spent_on: "2026-10-05",
    statement_closes_on: "2026-10-29", statement_due_on: "2026-11-11",
  };
  assert.equal(monthSummary([item], [CARD], { year: 2026, month: 9 }).totals.USD, 0);
  assert.equal(monthSummary([item], [CARD], MONTH).totals.USD, 20);
  assert.equal(monthSummary([item], [CARD], { year: 2026, month: 11 }).totals.USD, 0);
});

test("los cierres reales y el próximo vencimiento ubican compras manuales", () => {
  const card = {
    closing_day: 29, due_day: 11, last_closing_on: "2026-10-29", last_due_on: "2026-11-11",
    next_closing_on: "2026-11-26", next_due_on: "2026-12-09",
  };
  assert.deepEqual(purchasePeriod("2026-10-29", card), {
    statement_closes_on: "2026-10-29", statement_due_on: "2026-11-11",
  });
  assert.deepEqual(purchasePeriod("2026-10-30", card), {
    statement_closes_on: "2026-11-26", statement_due_on: "2026-12-09",
  });
  assert.equal(purchasePeriod("2026-11-26", card).statement_due_on, "2026-12-09");
  assert.equal(purchasePeriod("2026-11-27", card).statement_due_on, "2027-01-09");
});

test("las compras manuales cruzan diciembre, respetan febrero y pueden vencer en el mismo mes", () => {
  assert.deepEqual(purchasePeriod("2026-12-30", { closing_day: 29, due_day: 11 }), {
    statement_closes_on: "2027-01-29", statement_due_on: "2027-02-11",
  });
  assert.deepEqual(purchasePeriod("2027-02-28", { closing_day: 31, due_day: 10 }), {
    statement_closes_on: "2027-02-28", statement_due_on: "2027-03-10",
  });
  assert.equal(purchasePeriod("2026-11-02", { closing_day: 5, due_day: 15 }).statement_due_on, "2026-11-15");
  assert.equal(purchasePeriod("2026-11-02", { due_day: 15 }), null);
  assert.equal(parseIsoDate("2026-02-30"), null);
});

test("cada tarjeta calcula exclusivamente sus propios consumos", () => {
  const other = { id: "other", closing_day: 29, due_day: 11 };
  const items = [
    { card_id: CARD.id, amount: 100, currency: "ARS", spent_on: DATE, statement_due_on: "2026-11-11" },
    { card_id: other.id, amount: 200, currency: "ARS", spent_on: DATE, statement_due_on: "2026-11-11" },
  ];
  assert.equal(monthSummary(items, [CARD], MONTH).totals.ARS, 100);
  assert.equal(monthSummary(items, [other], MONTH).totals.ARS, 200);
  assert.equal(monthSummary(items, [CARD, other], MONTH).totals.ARS, 300);
});
