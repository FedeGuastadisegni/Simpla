import assert from "node:assert/strict";
import test from "node:test";
import {
  bankDifference,
  germanSchedule,
  loanHits,
  loansInMonth,
  duplicateBill,
  serviceAmountInMonth,
  serviceEstimate,
  subscriptionHits,
  subscriptionsInMonth,
  upcomingPayments,
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

const ALEMAN = {
  name: "Préstamo alemán",
  amortization: "aleman",
  remaining_principal: 1200000,
  remaining_installments: 12,
  tem: 5,
  cft: 79.5,
  installment_amount: 1,
};

test("EJEMPLO alemán: capital 1.200.000, 12 cuotas, TEM 5%", () => {
  const schedule = germanSchedule(ALEMAN);
  assert.equal(schedule.length, 12);
  assert.equal(schedule[0].amortization, 100000);
  assert.equal(schedule[0].interest, 60000);
  assert.equal(schedule[0].installment, 160000);
  assert.equal(schedule[1].installment, 155000);
  assert.equal(schedule[11].installment, 105000);
  assert.deepEqual(schedule.map((row) => row.installment), [
    160000, 155000, 150000, 145000, 140000, 135000, 130000, 125000, 120000, 115000, 110000, 105000,
  ]);
  assert.deepEqual(germanSchedule({ ...ALEMAN, cft: 200 }).map((row) => row.installment), schedule.map((row) => row.installment));
});

test("EJEMPLO alemán: la proyección usa la cuota del mes, y el banco solo si se ajusta", () => {
  const fija = {
    installment_amount: 95000,
    remaining_installments: 8,
  };
  assert.equal(loanHits(ALEMAN, NOV, NOV), 160000);
  assert.equal(loanHits(ALEMAN, DEC, NOV), 155000);
  assert.equal(loanHits(ALEMAN, { year: 2027, month: 9 }, NOV), 105000);
  assert.equal(loanHits(ALEMAN, { year: 2027, month: 10 }, NOV), 0);
  assert.equal(loansInMonth([ALEMAN, fija], NOV, NOV), 255000);
  assert.equal(loansInMonth([ALEMAN, fija], DEC, NOV), 250000);

  const withBank = { ...ALEMAN, current_installment_bank: 168000, adjust_bank: false };
  assert.equal(bankDifference(withBank).gap, 8000);
  assert.equal(bankDifference(withBank).calculated, 160000);
  assert.equal(loanHits(withBank, NOV, NOV), 160000);
  assert.equal(loanHits({ ...withBank, adjust_bank: true }, NOV, NOV), 168000);
  assert.equal(loanHits({ ...withBank, adjust_bank: true }, DEC, NOV), 163000);
  assert.equal(loanHits({ ...withBank, adjust_bank: true }, { year: 2027, month: 9 }, NOV), 113000);
  assert.equal(bankDifference({ ...withBank, current_installment_bank: 160000 }), null);
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

test("una factura repetida del mismo período no se suma al aumento", () => {
  const bills = [
    { period: "2026-07", amount: 100000, created_at: "2026-07-01" },
    { period: "2026-08", amount: 110000, created_at: "2026-08-01" },
    { period: "2026-09", amount: 121000, created_at: "2026-09-01" },
    { period: "2026-10", amount: 133100, created_at: "2026-10-01" },
    { period: "2026-10", amount: 133100, created_at: "2026-10-02" },
  ];
  const estimate = serviceEstimate(bills);
  assert.equal(estimate.rate, 0.1);
  assert.equal(estimate.billCount, 4);
  assert.equal(serviceAmountInMonth(bills, { year: 2026, month: 9 }).amount, 133100);
  assert.equal(serviceAmountInMonth(bills, NOV).amount, 146410);
});

test("si hay dos montos en el mismo período, queda el más reciente y no la suma", () => {
  const bills = [
    { period: "2026-10", amount: 133100, created_at: "2026-10-01" },
    { period: "2026-10", amount: 500000, created_at: "2026-10-20" },
  ];
  assert.equal(serviceAmountInMonth(bills, { year: 2026, month: 9 }).amount, 500000);
});

test("duplicateBill encuentra otra factura del mismo servicio y período", () => {
  const bills = [
    { id: "a", service_id: "edenor", period: "2026-10" },
    { id: "b", service_id: "edenor", period: "2026-09" },
  ];
  assert.equal(duplicateBill(bills, "edenor", "2026-10", null).id, "a");
  assert.equal(duplicateBill(bills, "edenor", "2026-10", "a"), null);
  assert.equal(duplicateBill(bills, "otro", "2026-10", null), null);
});

test("próximos pagos junta tarjeta, préstamo, servicio y suscripción", () => {
  const items = upcomingPayments({
    cards: [{ id: "visa", name: "Visa ejemplo", due_day: 10 }],
    cardItems: [{ card_id: "visa", description: "Heladera", amount: 100000, currency: "ARS", spent_on: "2026-11-02", installment_number: 1, installment_count: 2 }],
    loans: [{ name: "Préstamo personal", installment_amount: 95000, remaining_installments: 8 }],
    services: [{ id: "luz", name: "Edenor" }],
    serviceBills: [{ service_id: "luz", period: "2026-10", amount: 133100 }],
    subscriptions: [{ name: "Netflix", amount: 11999, currency: "ARS", frequency: "mensual", next_charge_on: "2026-11-05" }],
  }, "2026-11-05");
  assert.deepEqual(items.map((item) => item.title), ["Netflix", "Visa ejemplo", "Edenor", "Préstamo personal"]);
  assert.equal(items[0].day, "05");
  assert.equal(items[0].meta, "Suscripción");
  assert.equal(items[1].day, "10");
  assert.equal(items[1].amount, 100000);
  assert.equal(items[2].meta, "Servicio · estimado");
  assert.equal(items[3].amount, 95000);
});
