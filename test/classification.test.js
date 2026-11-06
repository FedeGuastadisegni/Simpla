import assert from "node:assert/strict";
import test from "node:test";
import { planClassifiedImport, suggestClassification } from "../statement-classification.js";
import { combinedForecast } from "../combined.js";
import { withCardEstimates, upcomingClassifiedPayments } from "../recurring.js";
import { buildExport, planImport } from "../backup.js";

const NOV = { year: 2026, month: 10 };
const card = { id: "card", closing_day: 29, due_day: 11, next_closing_on: "2026-11-26", next_due_on: "2026-12-09" };
const empty = () => ({ cards: [card], cardItems: [], subscriptions: [], services: [], serviceBills: [], loans: [] });
const charge = (extra = {}) => ({
  description: "Streaming", amount: 10, currency: "USD", spent_on: "2026-10-23",
  statement_closes_on: "2026-10-29", statement_due_on: "2026-11-11", selected: true,
  installment_number: null, installment_count: null, ...extra,
});
let id = 0;
function plan(rows, data = empty()) {
  return planClassifiedImport(rows, card.id, data, () => `new-${++id}`);
}
function apply(data, operations) {
  const next = structuredClone(data);
  const names = { card_items: "cardItems", subscriptions: "subscriptions", services: "services", service_bills: "serviceBills" };
  for (const op of operations) {
    const rows = next[names[op.table]];
    const index = rows.findIndex((row) => row.id === op.row.id);
    if (index < 0) rows.push(op.row); else rows[index] = op.row;
  }
  return next;
}
const subscription = { kind: "subscription", target_id: "new", name: "Streaming", frequency: "mensual" };
const service = { kind: "service", target_id: "new", name: "Internet", category: "internet", period: "2026-10" };

test("clasificar crea una suscripción, vincula el consumo y no duplica al reimportar", () => {
  const rows = [charge({ classification: subscription })];
  const first = plan(rows);
  assert.equal(first.ok, true);
  assert.deepEqual(first.ops.map((op) => op.table), ["subscriptions", "card_items"]);
  const data = apply(empty(), first.ops);
  assert.equal(data.subscriptions[0].card_id, card.id);
  assert.equal(data.subscriptions[0].next_charge_on, "2026-11-23");
  const linked = { ...subscription, target_id: data.subscriptions[0].id };
  const second = plan([charge({ classification: linked })], data);
  assert.equal(second.ok, true);
  assert.equal(second.ops.length, 0);
  assert.equal(suggestClassification(charge(), card.id, data).target_id, linked.target_id);
  assert.equal(suggestClassification(charge(), "other", data).kind, "normal");
});

test("un consumo ya cargado puede clasificarse sin crear otro", () => {
  const data = empty();
  data.cardItems = [{ ...charge(), id: "existing", card_id: card.id }];
  const first = plan([charge({ classification: subscription })], data);
  assert.equal(first.ops.filter((op) => op.table === "card_items")[0].row.id, "existing");
  assert.equal(first.ops.filter((op) => op.table === "card_items")[0].op, "update");
  assert.equal(apply(data, first.ops).cardItems.length, 1);
});

test("los servicios conservan el período facturado y se cuentan dentro de la tarjeta", () => {
  const first = plan([charge({ description: "Internet", currency: "ARS", amount: 100, classification: service })]);
  assert.equal(first.ok, true);
  assert.deepEqual(first.ops.map((op) => op.table), ["services", "service_bills", "card_items"]);
  const data = apply(empty(), first.ops);
  assert.equal(data.serviceBills[0].period, "2026-10");
  const months = combinedForecast(data, NOV, 3);
  assert.deepEqual(months.map((row) => row.totals.ARS), [100, 100, 100]);
  assert.deepEqual(months.map((row) => row.servicios), [0, 0, 0]);
  assert.equal(months[0].estimatedCardCharges.length, 0);
  assert.equal(months[1].estimatedCardCharges.length, 1);
  const suggestion = suggestClassification(charge({ description: "Internet", currency: "ARS", spent_on: "2026-11-23" }), card.id, data);
  assert.equal(suggestion.period, "2026-11");
  assert.equal(suggestion.kind, "service");
});

test("un cargo real reemplaza la estimación aunque cambie su monto", () => {
  const first = plan([charge({ classification: subscription })]);
  const data = apply(empty(), first.ops);
  const second = plan([charge({
    amount: 12, spent_on: "2026-11-23", statement_closes_on: "2026-11-26", statement_due_on: "2026-12-09",
    classification: { ...subscription, target_id: data.subscriptions[0].id },
  })], data);
  assert.equal(second.ok, true);
  const updated = apply(data, second.ops);
  const months = combinedForecast(updated, NOV, 3);
  assert.deepEqual(months.map((row) => row.totals.USD), [10, 12, 12]);
  assert.deepEqual(months.map((row) => row.estimatedCardCharges.length), [0, 0, 1]);
  assert.equal(updated.cardItems.length, 2);
  assert.equal(updated.subscriptions.length, 1);
});

test("una suscripción anual solo anticipa el cargo del año siguiente", () => {
  const first = plan([charge({ classification: { ...subscription, frequency: "anual" } })]);
  const data = apply(empty(), first.ops);
  const months = combinedForecast(data, NOV, 14);
  assert.equal(months[0].totals.USD, 10);
  assert.ok(months.slice(1, 12).every((row) => row.totals.USD === 0));
  assert.equal(months[12].totals.USD, 10);
  assert.equal(months[13].totals.USD, 0);
});

test("los servicios usan el importe facturado y luego estiman con su historial", () => {
  const first = plan([charge({ description: "Internet", currency: "ARS", amount: 100, classification: service })]);
  const data = apply(empty(), first.ops);
  const second = plan([charge({
    description: "Internet", currency: "ARS", amount: 110, spent_on: "2026-11-23",
    statement_closes_on: "2026-11-26", statement_due_on: "2026-12-09",
    classification: { ...service, target_id: data.services[0].id, period: "2026-11" },
  })], data);
  const months = combinedForecast(apply(data, second.ops), NOV, 3);
  assert.deepEqual(months.map((row) => row.totals.ARS), [100, 110, 121]);
});

test("vincular una factura manual actualiza el monto sin crear otra factura", () => {
  const data = empty();
  data.services = [{ id: "internet", name: "Internet", category: "internet" }];
  data.serviceBills = [{ id: "bill", service_id: "internet", period: "2026-10", amount: 99 }];
  const first = plan([charge({ currency: "ARS", amount: 100, classification: { ...service, target_id: "internet" } })], data);
  const next = apply(data, first.ops);
  assert.equal(next.serviceBills.length, 1);
  assert.equal(next.serviceBills[0].amount, 100);
  assert.equal(next.cardItems[0].service_bill_id, "bill");
});

test("compra normal no crea recurrencias, y los destildados no crean registros", () => {
  const first = plan([charge({ classification: { kind: "normal" } })]);
  assert.deepEqual(first.ops.map((op) => op.table), ["card_items"]);
  const data = apply(empty(), first.ops);
  assert.equal(withCardEstimates(data, NOV, 6).length, 1);
  assert.equal(plan([charge({ selected: false, classification: subscription })]).ops.length, 0);
});

test("rechaza vínculos inválidos, monedas incompatibles y períodos incorrectos sin devolver operaciones", () => {
  for (const classification of [
    { ...subscription, target_id: "missing" },
    { ...service, period: "2026-99" },
    { ...service, category: "missing" },
    { kind: "unknown" },
  ]) {
    const result = plan([charge({ currency: "ARS", classification })]);
    assert.equal(result.ok, false);
    assert.equal(result.ops, undefined);
  }
  assert.equal(plan([charge({ classification: service })]).ok, false);
  assert.equal(plan([charge({ installment_number: 1, installment_count: 3, classification: subscription })]).ok, false);
});

test("próximos pagos muestra un solo compromiso de tarjeta", () => {
  const first = plan([charge({ classification: subscription })]);
  const data = apply(empty(), first.ops);
  const payments = upcomingClassifiedPayments(data, "2026-12-05");
  assert.equal(payments.length, 1);
  assert.equal(payments[0].currency, "USD");
  assert.equal(payments[0].amount, 10);
});

test("los backups restauran el medio de pago y los vínculos de clasificación", () => {
  const first = plan([charge({ classification: subscription }), charge({ description: "Internet", currency: "ARS", amount: 100, classification: service })]);
  const data = apply(empty(), first.ops);
  const payload = buildExport({ cards: data.cards, card_items: data.cardItems, subscriptions: data.subscriptions, services: data.services, service_bills: data.serviceBills }, "2026-11-06");
  const restored = planImport(JSON.parse(JSON.stringify(payload)), {});
  assert.equal(restored.ok, true);
  assert.equal(restored.ops.find((op) => op.table === "subscriptions").row.card_id, card.id);
  assert.equal(restored.ops.find((op) => op.table === "services").row.card_id, card.id);
  const index = (table) => restored.ops.findIndex((op) => op.table === table);
  assert.ok(index("cards") < index("subscriptions"));
  assert.ok(index("service_bills") < index("card_items"));
});

test("las sugerencias conservan el desfase de facturación y no cambian al reimportar", () => {
  const first = plan([charge({ currency: "ARS", classification: { ...service, period: "2026-09" } })]);
  const data = apply(empty(), first.ops);
  assert.equal(suggestClassification(charge({ currency: "ARS" }), card.id, data).period, "2026-09");
  const next = suggestClassification(charge({ currency: "ARS", spent_on: "2026-11-23" }), card.id, data);
  assert.equal(next.period, "2026-10");
});

test("los cargos de fin de mes no derivan al día 28 después de febrero", () => {
  const data = empty();
  data.cards = [{ id: card.id, closing_day: 31, due_day: 10 }];
  const first = plan([charge({ spent_on: "2027-01-31", statement_closes_on: "2027-01-31", statement_due_on: "2027-02-10", classification: subscription })], data);
  const saved = apply(data, first.ops);
  const estimates = withCardEstimates(saved, { year: 2027, month: 1 }, 4).filter((row) => row.estimated);
  assert.ok(estimates.some((row) => row.spent_on === "2027-02-28"));
  assert.ok(estimates.some((row) => row.spent_on === "2027-03-31"));
  assert.equal(saved.cardItems.length, 1);
});

test("un error de clasificación no modifica los datos originales ni entrega un lote parcial", () => {
  const data = empty();
  const before = structuredClone(data);
  const result = plan([charge({ classification: subscription }), charge({ currency: "ARS", classification: { ...service, period: "incorrecto" } })], data);
  assert.equal(result.ok, false);
  assert.equal(result.ops, undefined);
  assert.deepEqual(data, before);
});

test("no vincula dos consumos distintos con una misma factura", () => {
  const first = plan([charge({ currency: "ARS", classification: service })]);
  const data = apply(empty(), first.ops);
  const result = plan([charge({ currency: "ARS", amount: 20, spent_on: "2026-10-24", classification: { ...service, target_id: data.services[0].id } })], data);
  assert.equal(result.ok, false);
});
