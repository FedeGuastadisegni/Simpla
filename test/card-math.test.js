import assert from "node:assert/strict";
import test from "node:test";
import { forecastMonths, monthSummary, statementMonth, sumByCurrency } from "../card-math.js";

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
  const month = statementMonth("2026-11-20", 5);
  assert.deepEqual(month, { year: 2026, month: 10 });
  assert.deepEqual(statementMonth("2026-11-20", null), { year: 2026, month: 10 });
  assert.equal(statementMonth("no-es-fecha", 10), null);
});
