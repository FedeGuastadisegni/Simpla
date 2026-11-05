import assert from "node:assert/strict";
import test from "node:test";
import { buildExport, planImport, validateImport } from "../backup.js";

const EXPORTED_AT = "2026-11-05T03:00:00.000Z";

function sample() {
  return {
    cards: [{
      id: "card-1",
      name: "Visa",
      due_day: 10,
      user_id: "usuario",
      email: "fedeguastadisegni@gmail.com",
      access_token: "token-secreto",
      refresh_token: "otro-token",
      session: { access_token: "adentro" },
    }],
    card_items: [{
      id: "item-1",
      card_id: "card-1",
      description: "Heladera 4532 1234 5678 9012",
      amount: 100000,
      currency: "ARS",
      spent_on: "2026-11-15",
      installment_number: 12,
      installment_count: 12,
      user_id: "usuario",
    }],
    loans: [{
      id: "loan-1",
      name: "Personal",
      installment_amount: 95000,
      remaining_installments: 8,
      ends_on: "2027-06-01",
    }],
    services: [],
    service_bills: [],
    subscriptions: [],
    expenses: [],
  };
}

test("el JSON exportado no tiene email, tokens ni sesión", () => {
  const payload = buildExport(sample(), EXPORTED_AT);
  const raw = JSON.stringify(payload);
  assert.equal(payload.version, 1);
  assert.equal(payload.exported_at, EXPORTED_AT);
  assert.equal(raw.includes("fedeguastadisegni@gmail.com"), false);
  assert.equal(raw.includes("token-secreto"), false);
  assert.equal(raw.includes("otro-token"), false);
  assert.equal(raw.includes("adentro"), false);
  assert.equal(raw.includes("access_token"), false);
  assert.equal(raw.includes("refresh_token"), false);
  assert.equal(raw.includes("user_id"), false);
  assert.equal(raw.includes('"email"'), false);
  assert.equal(raw.includes('"session"'), false);
  assert.equal(payload.data.cards[0].name, "Visa");
  assert.equal(payload.data.cards[0].due_day, 10);
});

test("importar no duplica: el id que ya existe se actualiza", () => {
  const payload = buildExport(sample(), EXPORTED_AT);
  const first = planImport(payload, { cards: [], card_items: [], loans: [], services: [], service_bills: [], subscriptions: [], expenses: [] });
  assert.equal(first.ok, true);
  assert.equal(first.summary, "1 tarjeta, 1 consumo, 1 préstamo");
  assert.deepEqual(first.ops.map((op) => op.op), ["insert", "insert", "insert"]);
  assert.equal(first.ops[1].row.description, "Heladera ••••");

  const existing = {
    cards: [{ id: "card-1" }],
    card_items: [{ id: "item-1" }],
    loans: [{ id: "loan-1" }],
    services: [],
    service_bills: [],
    subscriptions: [],
    expenses: [],
  };
  const second = planImport(payload, existing);
  assert.equal(second.ok, true);
  assert.deepEqual(second.ops.map((op) => op.op), ["update", "update", "update"]);
  assert.equal(new Set(second.ops.map((op) => op.row.id)).size, 3);
});

test("un archivo que no es de Simpla no se importa", () => {
  const result = validateImport({ version: 2, data: {} });
  assert.equal(result.ok, false);
  assert.equal(planImport({ hola: true }, {}).ok, false);
});
