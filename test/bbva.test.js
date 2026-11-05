import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchCard, parseBbvaStatement, planStatementImport } from "../bbva.js";

const TEXT = readFileSync(new URL("./fixtures/bbva-ejemplo.txt", import.meta.url), "utf8");

test("EJEMPLO BBVA: extrae los consumos y deja afuera titular, CUIT, cuenta, impuestos y cuotas a vencer", () => {
  const parsed = parseBbvaStatement(TEXT);
  const dumped = JSON.stringify(parsed);
  assert.equal(parsed.productName, "BBVA Mastercard");
  assert.equal(parsed.closingDay, 15);
  assert.equal(parsed.closingDate, "2026-10-15");
  assert.equal(parsed.dueDay, 1);
  assert.equal(parsed.dueDate, "2026-11-01");
  assert.equal(parsed.nextClosing, "2026-11-15");
  assert.equal(parsed.nextDue, "2026-12-01");
  assert.equal(parsed.balanceARS, 185432.1);
  assert.equal(parsed.balanceUSD, 40);
  assert.equal(parsed.charges.length, 8);
  assert.deepEqual(parsed.charges.map((row) => row.description), [
    "SUPER MERCADO EJEMPLO",
    "SWISS MEDICAL EJEMPLO",
    "CEBRA EJEMPLO",
    "XBOX MICROSOFT",
    "YOUTUBE PREMIUM",
    "GOOGLE ONE",
    "SPOTIFY",
    "FARMACIA EJEMPLO",
  ]);
  assert.equal(parsed.charges[0].amount, 12500);
  assert.equal(parsed.charges[0].currency, "ARS");
  assert.equal(parsed.charges[0].installment_number, null);
  assert.equal(parsed.charges[1].amount, 25015.95);
  assert.equal(parsed.charges[1].installment_number, 6);
  assert.equal(parsed.charges[1].installment_count, 12);
  assert.equal(parsed.charges[2].installment_number, 3);
  assert.equal(parsed.charges[2].installment_count, 3);
  assert.equal(parsed.charges[2].amount, 8200);
  assert.deepEqual(parsed.charges.slice(3, 7).map((row) => [row.currency, row.amount]), [
    ["USD", 9.99],
    ["USD", 7.99],
    ["USD", 2.99],
    ["USD", 19.03],
  ]);
  assert.equal(parsed.charges[7].amount, 3450.5);
  assert.equal(parsed.charges[7].spent_on, "2026-10-12");
  for (const secret of ["JUAN EJEMPLO", "Calle Falsa", "20-00000000-0", "0000-000000", "000-000000", "IIBB", "CUOTAS A VENCER", "50.031", "50031.91", "****"]) {
    assert.equal(dumped.includes(secret), false, secret);
  }
});

test("EJEMPLO BBVA: no duplica y sanea números largos", () => {
  const rows = [
    {
      selected: true,
      description: "SUPER 4532 1234 5678 9012",
      amount: 10,
      currency: "ARS",
      spent_on: "2026-10-01",
      installment_number: null,
      installment_count: null,
    },
    {
      selected: false,
      description: "NO VA",
      amount: 99,
      currency: "ARS",
      spent_on: "2026-10-02",
      installment_number: null,
      installment_count: null,
    },
  ];
  const first = planStatementImport(rows, "card-1", []);
  assert.equal(first.ok, true);
  assert.equal(first.inserts.length, 1);
  assert.equal(first.inserts[0].description, "SUPER ••••");
  assert.equal(first.loaded, 0);
  assert.equal(first.summary, "1 nuevos · 0 ya cargados · 1 ignorados");
  const stored = [{ ...first.inserts[0], id: "ya" }];
  const second = planStatementImport(rows, "card-1", stored);
  assert.equal(second.inserts.length, 0);
  assert.equal(second.loaded, 1);
  assert.equal(second.rows[0].status, "loaded");
  assert.equal(second.rows[0].reason, "Mismo pago, misma fecha.");
  const saved = JSON.stringify({ inserts: second.inserts, updates: second.updates });
  assert.equal(saved.includes("4532"), false);
  assert.equal(saved.includes("NO VA"), false);
  assert.equal(second.rows[1].status, "ignored");
});

test("EJEMPLO BBVA: la cuota siguiente actualiza el mismo consumo", () => {
  const stored = [{
    id: "swiss",
    card_id: "card-1",
    description: "SWISS MEDICAL EJEMPLO",
    amount: 25015.95,
    currency: "ARS",
    spent_on: "2026-09-03",
    installment_number: 5,
    installment_count: 12,
  }];
  const next = planStatementImport([{
    selected: true,
    description: "SWISS MEDICAL EJEMPLO",
    amount: 25015.95,
    currency: "ARS",
    spent_on: "2026-10-03",
    installment_number: 6,
    installment_count: 12,
  }], "card-1", stored);
  assert.equal(next.inserts.length, 0);
  assert.equal(next.updates.length, 1);
  assert.equal(next.updates[0].existingId, "swiss");
  assert.equal(next.updates[0].installment_number, 6);
  assert.equal(next.updates[0].spent_on, "2026-10-03");
  assert.equal(next.rows[0].status, "update");
  assert.equal(next.summary, "0 nuevos · 1 ya cargados (se actualiza cuota) · 0 ignorados");

  const same = planStatementImport([{
    selected: true,
    description: "SWISS MEDICAL EJEMPLO",
    amount: 25015.95,
    currency: "ARS",
    spent_on: "2026-10-03",
    installment_number: 5,
    installment_count: 12,
  }], "card-1", stored);
  assert.equal(same.updates.length, 0);
  assert.equal(same.rows[0].status, "loaded");

  const skippedMonth = planStatementImport([{
    selected: true,
    description: "SWISS MEDICAL EJEMPLO",
    amount: 25015.95,
    currency: "ARS",
    spent_on: "2026-12-03",
    installment_number: 8,
    installment_count: 12,
  }], "card-1", stored);
  assert.equal(skippedMonth.updates[0].installment_number, 8);

  const older = planStatementImport([{
    selected: true,
    description: "SWISS MEDICAL EJEMPLO",
    amount: 25015.95,
    currency: "ARS",
    spent_on: "2026-08-03",
    installment_number: 4,
    installment_count: 12,
  }], "card-1", stored);
  assert.equal(older.updates.length, 0);
  assert.equal(older.rows[0].status, "loaded");
  assert.equal(older.rows[0].reason.includes("más adelante"), true);
});

test("un consumo a mano se vincula y no se duplica", () => {
  const stored = [{
    id: "mano",
    card_id: "card-1",
    description: "Farmacia",
    amount: 3450.5,
    currency: "ARS",
    spent_on: "2026-10-08",
    installment_number: null,
    installment_count: null,
  }];
  const plan = planStatementImport([{
    selected: true,
    description: "FARMACIA EJEMPLO",
    amount: 3450.5,
    currency: "ARS",
    spent_on: "2026-10-12",
    installment_number: null,
    installment_count: null,
  }], "card-1", stored);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.links, 1);
  assert.equal(plan.updates[0].existingId, "mano");
  assert.equal(plan.updates[0].spent_on, "2026-10-12");
  assert.equal(plan.updates[0].description, "FARMACIA EJEMPLO");
  assert.equal(plan.rows[0].status, "link");
  assert.equal(plan.rows[0].reason, "Se vinculó con un consumo que cargaste a mano.");
  assert.equal(plan.summary.includes("1 a mano"), true);
});

test("una cuota a mano pasa a la siguiente sin alta nueva", () => {
  const stored = [{
    id: "swiss",
    card_id: "card-1",
    description: "Swiss Medical",
    amount: 25015.95,
    currency: "ARS",
    spent_on: "2026-09-03",
    installment_number: 5,
    installment_count: 12,
  }];
  const plan = planStatementImport([{
    selected: true,
    description: "SWISS MEDICAL EJEMPLO",
    amount: 25015.95,
    currency: "ARS",
    spent_on: "2026-10-03",
    installment_number: 6,
    installment_count: 12,
  }], "card-1", stored);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].existingId, "swiss");
  assert.equal(plan.updates[0].installment_number, 6);
  assert.equal(plan.rows[0].status, "update");
  assert.equal(plan.rows[0].reason.includes("cargaste a mano"), true);
});

test("otra moneda o otro comercio no matchean", () => {
  const stored = [{
    id: "mano",
    card_id: "card-1",
    description: "Farmacia",
    amount: 3450.5,
    currency: "ARS",
    spent_on: "2026-10-08",
    installment_number: null,
    installment_count: null,
  }];
  const otherCurrency = planStatementImport([{
    selected: true,
    description: "FARMACIA EJEMPLO",
    amount: 3450.5,
    currency: "USD",
    spent_on: "2026-10-12",
    installment_number: null,
    installment_count: null,
  }], "card-1", stored);
  assert.equal(otherCurrency.inserts.length, 1);
  assert.equal(otherCurrency.links, 0);
  assert.equal(otherCurrency.rows[0].status, "new");

  const otherShop = planStatementImport([{
    selected: true,
    description: "LIBRERIA NUEVA",
    amount: 3450.5,
    currency: "ARS",
    spent_on: "2026-10-12",
    installment_number: null,
    installment_count: null,
  }], "card-1", stored);
  assert.equal(otherShop.inserts.length, 1);
  assert.equal(otherShop.rows[0].status, "new");

  const farDate = planStatementImport([{
    selected: true,
    description: "FARMACIA EJEMPLO",
    amount: 3450.5,
    currency: "ARS",
    spent_on: "2026-07-01",
    installment_number: null,
    installment_count: null,
  }], "card-1", stored);
  assert.equal(farDate.inserts.length, 1);
  assert.equal(farDate.rows[0].status, "new");
});

test("se puede forzar un alta si el vínculo está mal", () => {
  const stored = [{
    id: "mano",
    card_id: "card-1",
    description: "Farmacia",
    amount: 3450.5,
    currency: "ARS",
    spent_on: "2026-10-08",
    installment_number: null,
    installment_count: null,
  }];
  const line = {
    selected: true,
    force_new: true,
    description: "FARMACIA EJEMPLO",
    amount: 3450.5,
    currency: "ARS",
    spent_on: "2026-10-12",
    installment_number: null,
    installment_count: null,
  };
  const plan = planStatementImport([line], "card-1", stored);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.rows[0].status, "new");
  assert.equal(plan.rows[0].hadMatch, true);
});

test("EJEMPLO BBVA: reutiliza una tarjeta parecida y no usa una Visa distinta", () => {
  const cards = [
    { id: "visa", name: "Visa ejemplo" },
    { id: "bbva", name: "Mi BBVA Mastercard" },
  ];
  assert.equal(matchCard(cards, "BBVA Mastercard").id, "bbva");
  assert.equal(matchCard([{ id: "visa", name: "Visa ejemplo" }], "BBVA Mastercard"), null);
  assert.equal(matchCard([{ id: "same", name: "BBVA Mastercard" }], "bbva mastercard").id, "same");
});
