import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCardStatement, planStatementImport, matchCard } from "../statement-parser.js";
import { forecastMonths, monthSummary } from "../card-math.js";
import { combinedForecast, nextMonthChange } from "../combined.js";
import { upcomingPayments } from "../projections.js";
import { buildExport, planImport } from "../backup.js";
import { dueSoon } from "../alerts.js";

const NOV = { year: 2026, month: 10 };
const card = { id: "card", closing_day: 29, due_day: 11 };
const fixture = readFileSync(new URL("./fixtures/statement-visa.txt", import.meta.url), "utf8");
const parsed = parseCardStatement(fixture);
const rows = parsed.charges.map((row) => ({
  ...row, statement_closes_on: parsed.closingDate, statement_due_on: parsed.dueDate,
}));

test("el resumen de octubre se paga en noviembre e incluye su última cuota de una compra de mayo", () => {
  const plan = planStatementImport(rows, card.id, []);
  assert.equal(plan.ok, true);
  const items = plan.inserts;
  assert.equal(monthSummary(items, [card], NOV).totals.ARS, 611141.08);
  const last = monthSummary(items, [card], NOV).ending.find((row) => row.description === "MERPAGO*MIMOCO");
  assert.equal(last.amount, 54366.66);
  assert.equal(last.spent_on, "2026-05-03");
  const long = items.find((row) => row.description === "MERPAGO*SIMMONSBELMOYOLO");
  const months = forecastMonths([long], [card], NOV, 11);
  assert.equal(months[1].charges[0].installment_number, 10);
  assert.equal(months[9].ending[0].installment_number, 18);
  assert.equal(months[10].totals.ARS, 0);
});

test("reimportar confirma el período de los consumos anteriores sin duplicarlos", () => {
  const existing = parsed.charges.map((row, index) => ({ ...row, card_id: card.id, id: `item-${index}` }));
  const plan = planStatementImport(rows, card.id, existing);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, rows.length);
  const restored = plan.updates.map(({ existingId, manual, ...row }) => ({ ...row, id: existingId }));
  const second = planStatementImport(rows, card.id, restored);
  assert.equal(second.updates.length, 0);
  assert.equal(second.inserts.length, 0);
  assert.equal(second.loaded, rows.length);
});

test("avanzar a la cuota siguiente mantiene la fecha de compra y no mueve el final del plan", () => {
  const existing = { ...rows[0], id: "purchase", card_id: card.id };
  const plan = planStatementImport([{
    ...rows[0], installment_number: 10, statement_closes_on: "2026-11-26", statement_due_on: "2026-12-09",
  }], card.id, [existing]);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates[0].existingId, existing.id);
  assert.equal(plan.updates[0].spent_on, "2026-02-10");
  const updated = { ...existing, ...plan.updates[0] };
  const months = forecastMonths([updated], [card], NOV, 11);
  assert.equal(months[0].charges[0].installment_number, 9);
  assert.equal(months[9].ending[0].installment_number, 18);
  assert.equal(months[10].totals.ARS, 0);
  assert.equal(planStatementImport([rows[0]], card.id, [updated]).updates.length, 0);
});

test("el insight informa la liberación en el mes de pago de la última cuota", () => {
  const item = { ...rows[0], card_id: card.id, installment_number: 2, installment_count: 3, amount: 100 };
  const data = { cards: [card], cardItems: [item], loans: [], services: [], serviceBills: [], subscriptions: [] };
  const months = combinedForecast(data, NOV, 3);
  assert.equal(nextMonthChange(months[0], months[1]).ending.length, 0);
  const change = nextMonthChange(months[1], months[2]);
  assert.equal(change.ending[0].name, item.description);
  assert.equal(change.drop.ARS, 100);
  assert.equal(change.delta.ARS, -100);
});

test("próximos pagos separa los importes de dos tarjetas", () => {
  const other = { ...card, id: "other", name: "MasterCard", due_day: 15 };
  const data = {
    cards: [{ ...card, name: "VISA" }, other],
    cardItems: [
      { ...rows[0], card_id: card.id, amount: 100 },
      { ...rows[0], card_id: other.id, amount: 200, statement_due_on: "2026-11-15" },
    ],
  };
  assert.deepEqual(upcomingPayments(data, "2026-11-05").map((row) => [row.title, row.amount]), [["VISA", 100], ["MasterCard", 200]]);
});

test("próximos pagos y alertas respetan el vencimiento real del próximo resumen", () => {
  const actual = {
    ...card, name: "VISA", last_closing_on: "2026-10-29", last_due_on: "2026-11-11",
    next_closing_on: "2026-11-26", next_due_on: "2026-12-09",
  };
  const payments = upcomingPayments({ cards: [actual], cardItems: [{ ...rows[0], card_id: card.id, amount: 100 }] }, "2026-12-05");
  assert.equal(payments[0].date, "2026-12-09");
  assert.equal(payments[0].amount, 100);
  const alerts = dueSoon({ cards: [actual] }, "2026-12-05", 7);
  assert.equal(alerts.find((alert) => alert.kind === "vencimiento").date, "2026-12-09");
});

test("los backups conservan períodos y vínculos, restaurando primero las entidades referenciadas", () => {
  const subscription = { id: "sub", name: "Streaming", amount: 10, currency: "USD", frequency: "mensual", next_charge_on: "2026-11-05", on_card: true };
  const service = { id: "service", name: "Internet", category: "internet" };
  const bill = { id: "bill", service_id: service.id, period: "2026-10", amount: 100 };
  const tables = {
    cards: [{ ...card, last_closing_on: "2026-10-29", last_due_on: "2026-11-11" }],
    card_items: [
      { ...rows[0], id: "linked-sub", card_id: card.id, subscription_id: subscription.id },
      { ...rows[1], id: "linked-bill", card_id: card.id, service_bill_id: bill.id },
    ], services: [service], service_bills: [bill], subscriptions: [subscription],
  };
  const payload = buildExport(tables, "2026-11-05");
  const plan = planImport(JSON.parse(JSON.stringify(payload)), {});
  assert.equal(plan.ok, true);
  for (const item of tables.card_items) {
    const { selected, ...saved } = item;
    assert.deepEqual(plan.ops.find((op) => op.row.id === item.id).row, saved);
  }
  const index = (id) => plan.ops.findIndex((op) => op.row.id === id);
  assert.ok(index(subscription.id) < index("linked-sub"));
  assert.ok(index(service.id) < index(bill.id));
  assert.ok(index(bill.id) < index("linked-bill"));
  assert.equal(payload.data.cards[0].last_due_on, "2026-11-11");
});

test("la importación persiste solo los datos confirmados y rechaza períodos imposibles", () => {
  const raw = { ...rows[0], file: fixture, raw_text: fixture, owner: "Titular de ejemplo", document: { bytes: [1, 2, 3] } };
  const plan = planStatementImport([raw], card.id, []);
  const payload = buildExport({ card_items: [{ id: "item", ...plan.inserts[0] }] }, "2026-11-05");
  for (const key of ["file", "raw_text", "owner", "document"]) {
    assert.equal(Object.hasOwn(plan.inserts[0], key), false);
    assert.equal(Object.hasOwn(payload.data.card_items[0], key), false);
  }
  assert.equal(planStatementImport([{ ...rows[0], statement_due_on: "2026-10-01" }], card.id, []).ok, false);
  assert.equal(planStatementImport([{ ...rows[0], statement_due_on: "2026-02-30" }], card.id, []).ok, false);
});

test("se sugieren nombres genéricos y una marca ambigua no elige una tarjeta arbitraria", () => {
  assert.equal(parsed.productName, "Tarjeta de Crédito VISA");
  assert.equal(matchCard([{ id: "one", name: "VISA personal" }], parsed.productName).id, "one");
  assert.equal(matchCard([{ id: "one", name: "VISA personal" }, { id: "two", name: "VISA adicional" }], parsed.productName), null);
});
