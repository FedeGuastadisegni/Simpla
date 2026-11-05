import assert from "node:assert/strict";
import test from "node:test";
import {
  loanHits,
  loansInMonth,
  serviceAmountInMonth,
  serviceEstimate,
  subscriptionHits,
  subscriptionsInMonth,
} from "../projections.js";

const NOV = { year: 2026, month: 10 };
const DEC = { year: 2026, month: 11 };
const JUN = { year: 2027, month: 5 };
const JUL = { year: 2027, month: 6 };
const NOV_NEXT = { year: 2027, month: 10 };

test("EJEMPLO préstamos: la cuota de 95.000 se repite 8 meses y corta en el noveno", () => {
  const loan = {
    name: "Préstamo personal",
    installment_amount: 95000,
    remaining_installments: 8,
    ends_on: "2027-06-01",
  };
  assert.equal(loanHits(loan, NOV, NOV), 95000);
  assert.equal(loanHits(loan, DEC, NOV), 95000);
  assert.equal(loanHits(loan, JUN, NOV), 95000);
  assert.equal(loanHits(loan, JUL, NOV), 0);
  assert.equal(loansInMonth([loan, { ...loan, remaining_installments: 0 }], NOV, NOV), 95000);
});

test("EJEMPLO suscripciones: mensual todos los meses y anual solo en su mes, USD aparte", () => {
  const netflix = {
    name: "Netflix",
    amount: 11999,
    currency: "ARS",
    frequency: "mensual",
    next_charge_on: "2026-11-05",
  };
  const icloud = {
    name: "iCloud",
    amount: 20,
    currency: "USD",
    frequency: "anual",
    next_charge_on: "2026-11-01",
  };
  const october = { year: 2026, month: 9 };
  assert.equal(subscriptionHits(netflix, october), false);
  assert.deepEqual(subscriptionsInMonth([netflix, icloud], NOV), { ARS: 11999, USD: 20 });
  assert.deepEqual(subscriptionsInMonth([netflix, icloud], DEC), { ARS: 11999, USD: 0 });
  assert.deepEqual(subscriptionsInMonth([netflix, icloud], NOV_NEXT), { ARS: 11999, USD: 20 });
});

test("EJEMPLO servicios: 10% promedio de 4 facturas, en cadena desde la última", () => {
  const bills = [
    { period: "2026-07", amount: 100000 },
    { period: "2026-08", amount: 110000 },
    { period: "2026-09", amount: 121000 },
    { period: "2026-10", amount: 133100 },
  ];
  const estimate = serviceEstimate(bills);
  assert.equal(estimate.rate, 0.1);
  assert.equal(estimate.gaps, false);
  assert.equal(estimate.text, "Aumento promedio de las últimas 4 facturas: 10% por mes.");
  assert.equal(serviceAmountInMonth(bills, { year: 2026, month: 9 }).amount, 133100);
  assert.equal(serviceAmountInMonth(bills, NOV).amount, 146410);
  assert.equal(serviceAmountInMonth(bills, DEC).amount, 161051);
});

test("EJEMPLO servicios: una sola factura se repite y lo dice", () => {
  const bills = [{ period: "2026-10", amount: 27500 }];
  const november = serviceAmountInMonth(bills, NOV);
  assert.equal(november.amount, 27500);
  assert.equal(november.estimated, true);
  assert.equal(november.estimate.text, "Falta historial para estimar el aumento.");
  assert.equal(serviceAmountInMonth(bills, DEC).amount, 27500);
});

test("EJEMPLO servicios: sin facturas no hay proyección", () => {
  const result = serviceAmountInMonth([], NOV);
  assert.equal(result.amount, null);
  assert.equal(result.estimate.text, null);
});

test("EJEMPLO servicios: un mes faltante no entra en el promedio", () => {
  const bills = [
    { period: "2026-07", amount: 10000 },
    { period: "2026-08", amount: 11000 },
    { period: "2026-10", amount: 20000 },
  ];
  const estimate = serviceEstimate(bills);
  assert.equal(estimate.gaps, true);
  assert.equal(estimate.rate, 0.1);
  assert.equal(
    estimate.text,
    "Hay meses sin factura: el promedio usa solo los meses consecutivos. Aumento promedio de las últimas 3 facturas: 10% por mes."
  );
  assert.equal(serviceAmountInMonth(bills, NOV).amount, 22000);
});
