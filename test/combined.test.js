import assert from "node:assert/strict";
import test from "node:test";
import { combinedForecast, monthDelta, nextMonthChange } from "../combined.js";
import { roundMoney } from "../projections.js";

// EJEMPLO. Los mismos datos de la tarjeta, los préstamos, los servicios
// y las suscripciones. Los totales de abajo están escritos a mano.
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

// Noviembre a abril, a mano:
// tarjeta 180000, 50000, 50000, 50000, 50000, 0
// préstamo 95000 los seis meses
// Edenor 146410, 161051, 177156.1, 194871.71, 214358.88, 235794.77
// enero: 50000+95000+177156.1+27500+11999 = 361655.1
// Telecentro 27500 los seis
// Netflix 11999 los seis
// USD: noviembre 20 de la tarjeta + 20 de iCloud; después 0
const EXPECTED = [
  { ARS: 460909, USD: 40 },
  { ARS: 345550, USD: 0 },
  { ARS: 361655.1, USD: 0 },
  { ARS: 379370.71, USD: 0 },
  { ARS: 398857.88, USD: 0 },
  { ARS: 370293.77, USD: 0 },
];

test("EJEMPLO proyección: totales de los seis meses, ARS y USD separados", () => {
  const months = combinedForecast(DATA, NOV, 6);
  assert.equal(months.length, 6);
  months.forEach((month, index) => {
    assert.equal(month.totals.ARS, EXPECTED[index].ARS);
    assert.equal(month.totals.USD, EXPECTED[index].USD);
  });
  assert.equal(months[0].tarjeta.ARS + months[0].tarjeta.USD === months[0].totals.ARS, false);
});

test("EJEMPLO proyección: el préstamo decreciente baja en los seis meses", () => {
  const data = {
    ...DATA,
    loans: [
      ...DATA.loans,
      {
        name: "Préstamo alemán",
        amortization: "aleman",
        remaining_principal: 1200000,
        remaining_installments: 12,
        tem: 5,
        installment_amount: 1,
        adjust_bank: false,
      },
    ],
  };
  const months = combinedForecast(data, NOV, 6);
  const loans = [255000, 250000, 245000, 240000, 235000, 230000];
  const totals = [620909, 500550, 511655.1, 524370.71, 538857.88, 505293.77];
  months.forEach((month, index) => {
    assert.equal(month.prestamos, loans[index]);
    assert.equal(month.totals.ARS, totals[index]);
    assert.equal(month.totals.USD, index === 0 ? 40 : 0);
  });
});

test("una suscripción en tarjeta no infla los fijos ni la proyección", () => {
  const base = combinedForecast(DATA, NOV, 6);
  const data = {
    ...DATA,
    subscriptions: DATA.subscriptions.map((subscription) => (
      subscription.name === "Netflix" ? { ...subscription, on_card: true } : subscription
    )),
  };
  const months = combinedForecast(data, NOV, 6);
  months.forEach((month, index) => {
    assert.equal(month.suscripciones.ARS, 0);
    assert.equal(month.totals.ARS, roundMoney(base[index].totals.ARS - 11999));
    assert.equal(month.totals.USD, base[index].totals.USD);
  });
  const pair = combinedForecast(data, NOV, 2);
  const change = nextMonthChange(pair[0], pair[1], data.subscriptions);
  assert.deepEqual(change.subscriptions.map((item) => item.name), []);
  assert.equal(change.delta.ARS, monthDelta(base[0], base[1]).ARS);
  assert.equal(change.delta.USD, monthDelta(base[0], base[1]).USD);
});

test("EJEMPLO proyección: en diciembre baja por las cuotas que terminan", () => {
  const months = combinedForecast(DATA, NOV, 6);
  const delta = monthDelta(months[0], months[1]);
  assert.equal(delta.ARS, -115359);
  assert.equal(delta.USD, -40);
  assert.deepEqual(months[0].endingCards.map((item) => item.description).sort(), ["Heladera", "Zapatillas"]);
  assert.equal(months[0].endingLoans.length, 0);
  const edenor = months[1].serviceDetails.find((service) => service.name === "Edenor");
  const telecentro = months[1].serviceDetails.find((service) => service.name === "Telecentro");
  assert.equal(edenor.estimated, true);
  assert.equal(edenor.text, "Aumento promedio de las últimas 4 facturas: 10% por mes.");
  assert.equal(telecentro.text, "Falta historial para estimar el aumento.");
});
