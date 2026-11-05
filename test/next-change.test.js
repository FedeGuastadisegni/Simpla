import assert from "node:assert/strict";
import test from "node:test";
import { combinedForecast, nextMonthChange } from "../combined.js";

const NOV = { year: 2026, month: 10 };

const DATA = {
  cards: [{ id: "card-ejemplo", due_day: 10 }],
  cardItems: [
    {
      id: "heladera",
      card_id: "card-ejemplo",
      description: "Heladera",
      amount: 100000,
      currency: "ARS",
      spent_on: "2026-11-15",
      installment_number: 12,
      installment_count: 12,
    },
    {
      id: "zapatillas",
      card_id: "card-ejemplo",
      description: "Zapatillas",
      amount: 30000,
      currency: "ARS",
      spent_on: "2026-11-15",
      installment_number: 3,
      installment_count: 3,
    },
    {
      id: "en-curso",
      card_id: "card-ejemplo",
      description: "Cuota en curso",
      amount: 50000,
      currency: "ARS",
      spent_on: "2026-11-15",
      installment_number: 2,
      installment_count: 6,
    },
    {
      id: "usd",
      card_id: "card-ejemplo",
      description: "Consumo en dólares",
      amount: 20,
      currency: "USD",
      spent_on: "2026-11-15",
      installment_number: null,
      installment_count: null,
    },
  ],
  loans: [{
    name: "Préstamo personal",
    installment_amount: 95000,
    remaining_installments: 8,
    ends_on: "2027-06-01",
  }],
  subscriptions: [
    {
      name: "Netflix",
      amount: 11999,
      currency: "ARS",
      frequency: "mensual",
      next_charge_on: "2026-11-05",
    },
    {
      name: "iCloud",
      amount: 20,
      currency: "USD",
      frequency: "anual",
      next_charge_on: "2026-11-01",
    },
  ],
  services: [
    { id: "edenor", name: "Edenor" },
    { id: "telecentro", name: "Telecentro" },
  ],
  serviceBills: [
    { service_id: "edenor", period: "2026-07", amount: 100000 },
    { service_id: "edenor", period: "2026-08", amount: 110000 },
    { service_id: "edenor", period: "2026-09", amount: 121000 },
    { service_id: "edenor", period: "2026-10", amount: 133100 },
    { service_id: "telecentro", period: "2026-10", amount: 27500 },
  ],
};

test("el mes que viene baja por las cuotas que terminan y sube el servicio con historial", () => {
  const months = combinedForecast(DATA, NOV, 2);
  const change = nextMonthChange(months[0], months[1], DATA.subscriptions);
  assert.equal(change.quiet, false);
  assert.deepEqual(change.ending.map((item) => item.name).sort(), ["Heladera", "Zapatillas"]);
  assert.equal(change.drop.ARS, 130000);
  assert.equal(change.drop.USD, 0);
  const edenor = change.services.find((service) => service.name === "Edenor");
  const telecentro = change.services.find((service) => service.name === "Telecentro");
  assert.equal(edenor.kind, "sube");
  assert.equal(edenor.now, 146410);
  assert.equal(edenor.next, 161051);
  assert.equal(telecentro.kind, "sin-historial");
  assert.match(telecentro.text, /falta historial/i);
  assert.deepEqual(change.subscriptions.map((item) => item.name), ["Netflix"]);
  assert.equal(change.subscriptions[0].currency, "ARS");
  assert.equal(change.delta.ARS, -115359);
  assert.equal(change.delta.USD, -40);
});

test("un préstamo que termina aporta su cuota real, no un monto inventado", () => {
  const data = {
    cards: [],
    cardItems: [],
    loans: [{ name: "Corto", installment_amount: 5000, remaining_installments: 1, ends_on: "2026-11-01" }],
    subscriptions: [],
    services: [],
    serviceBills: [],
  };
  const months = combinedForecast(data, NOV, 2);
  assert.equal(months[0].endingLoans[0].endingAmount, 5000);
  const change = nextMonthChange(months[0], months[1], []);
  assert.equal(change.drop.ARS, 5000);
  assert.equal(change.ending[0].kind, "prestamo");
  assert.equal(change.delta.ARS, -5000);
});

test("sin cambios el resumen queda vacío", () => {
  const month = {
    month: { year: 2026, month: 10 },
    totals: { ARS: 1000, USD: 0 },
    endingCards: [],
    endingLoans: [],
    serviceDetails: [],
  };
  const next = { ...month, month: { year: 2026, month: 11 } };
  const change = nextMonthChange(month, next, []);
  assert.equal(change.quiet, true);
  assert.equal(change.delta.ARS, 0);
  assert.equal(change.delta.USD, 0);
});
