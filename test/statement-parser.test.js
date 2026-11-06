import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchCard, normalizeOcrText, parseCardStatement, planStatementImport } from "../statement-parser.js";

const TEXT = readFileSync(new URL("./fixtures/statement-mastercard.txt", import.meta.url), "utf8");
const VISA = readFileSync(new URL("./fixtures/statement-visa.txt", import.meta.url), "utf8");

test("EJEMPLO: extrae los consumos y deja afuera titular, CUIT, cuenta, impuestos y cuotas a vencer", () => {
  const parsed = parseCardStatement(TEXT);
  const dumped = JSON.stringify(parsed);
  assert.equal(parsed.productName, "Tarjeta de Crédito MasterCard");
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

test("EJEMPLO: no duplica y sanea números largos", () => {
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

test("EJEMPLO: la cuota siguiente actualiza el mismo consumo", () => {
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

test("EJEMPLO: reutiliza una tarjeta parecida y no usa una Visa distinta", () => {
  const cards = [
    { id: "visa", name: "Visa ejemplo" },
    { id: "emisor", name: "Mi Tarjeta de Crédito MasterCard" },
  ];
  assert.equal(matchCard(cards, "Tarjeta de Crédito MasterCard").id, "emisor");
  assert.equal(matchCard([{ id: "visa", name: "Visa ejemplo" }], "Tarjeta de Crédito MasterCard"), null);
  assert.equal(matchCard([{ id: "same", name: "Tarjeta de Crédito MasterCard" }], "tarjeta de credito mastercard").id, "same");
});

const OCR_EJEMPLO = `
Visa ejemplo
Fecha de cierre : 15 / 10 / 2026
Fecha de vencimiento : 01 / 11 / 2026
Titular: JUAN EJEMPLO
CUIT: 20-00000000-0
01 / 10 / 2026   SUPER MERCADO EJEMPLO   12.500,00
03/10/2026 SWISS MEDICAL EJEMPLO C. 06 / 12 25.015,95
IMPUESTOS Y PERCEPCIONES
IIBB CABA 450,00
`;

test("EJEMPLO OCR: el texto de una captura entra al mismo parser y no inventa impuestos", () => {
  const parsed = parseCardStatement(normalizeOcrText(OCR_EJEMPLO));
  const dumped = JSON.stringify(parsed.charges);
  assert.equal(parsed.productName, "Tarjeta de Crédito VISA");
  assert.equal(parsed.closingDate, "2026-10-15");
  assert.equal(parsed.dueDate, "2026-11-01");
  assert.equal(parsed.charges.length, 2);
  assert.equal(parsed.charges[0].description, "SUPER MERCADO EJEMPLO");
  assert.equal(parsed.charges[0].amount, 12500);
  assert.equal(parsed.charges[1].description, "SWISS MEDICAL EJEMPLO");
  assert.equal(parsed.charges[1].installment_number, 6);
  assert.equal(parsed.charges[1].installment_count, 12);
  assert.equal(dumped.includes("JUAN EJEMPLO"), false);
  assert.equal(dumped.includes("20-00000000-0"), false);
  assert.equal(dumped.includes("IIBB"), false);
  assert.equal(parseCardStatement(normalizeOcrText("hola esto no es un resumen")).charges.length, 0);
});

test("Visa Signature: lee los consumos del PDF (columnas separadas) y deja afuera pagos, impuestos y titular", () => {
  const parsed = parseCardStatement(VISA);
  const dumped = JSON.stringify(parsed);
  assert.equal(parsed.productName, "Tarjeta de Crédito VISA");
  assert.equal(parsed.closingDay, 29);
  assert.equal(parsed.closingDate, "2026-10-29");
  assert.equal(parsed.dueDay, 11);
  assert.equal(parsed.dueDate, "2026-11-11");
  assert.equal(parsed.nextClosing, "2026-11-26");
  assert.equal(parsed.nextDue, "2026-12-09");
  assert.equal(parsed.charges.length, 29);
  assert.deepEqual(parsed.charges[0], {
    spent_on: "2026-02-10",
    description: "MERPAGO*SIMMONSBELMOYOLO",
    amount: 75378.68,
    currency: "ARS",
    installment_number: 9,
    installment_count: 18,
    selected: true,
  });
  const west = parsed.charges.find((row) => row.description === "MERPAGO*WEST");
  assert.equal(west.spent_on, "2026-04-22");
  assert.equal(west.amount, 7272.71);
  assert.equal(west.installment_number, 7);
  assert.equal(west.installment_count, 12);
  const mcg = parsed.charges.find((row) => row.description === "MERPAGO*MCG");
  assert.equal(mcg.spent_on, "2026-08-10");
  assert.equal(mcg.installment_number, 3);
  assert.equal(mcg.installment_count, 9);
  const farma = parsed.charges.find((row) => row.description.startsWith("FARMACITY"));
  assert.deepEqual(farma, {
    spent_on: "2026-10-08",
    description: "FARMACITY 68",
    amount: 23399,
    currency: "ARS",
    installment_number: null,
    installment_count: null,
    selected: true,
  });
  const tele = parsed.charges.find((row) => row.description.startsWith("TELECENTRO"));
  assert.equal(tele.spent_on, "2026-10-23");
  assert.equal(tele.amount, 40059.28);
  assert.equal(tele.currency, "ARS");
  assert.equal(tele.installment_number, null);
  assert.equal(parsed.charges.some((row) => /^(su pago|impuesto|saldo)\b/i.test(row.description)), false);
  const cents = parsed.charges.reduce((acc, row) => acc + Math.round(row.amount * 100), 0);
  assert.equal(cents, 61114108);
  for (const secret of ["TITULAR EJEMPLO", "Calle Falsa", "0000-000000", "GUASTADISEGNI", "0793084926"]) {
    assert.equal(dumped.includes(secret), false, secret);
  }
});

// NETFLIX no está en el resumen: la columna dólares de este PDF viene vacía.
const OCR_VISA = `
Visa
Banco Emisor
CIERRE ACTUAL 29 - Oct - 26
VENCIMIENTO ACTUAL
11 - Nov - 26
PRÓXIMO CIERRE 26 - Nov - 26
PRÓXIMO VENCIMIENTO 09 - Dic - 26
Consumos F Ejemplo
10 - Feb - 26 MERPAGO*SIMMONSBELMOYOLO C. 09 / 18 218828 75.378,68
08 - Oct - 26 FARMACITY 68 000267 23.399,00
23 - Oct - 26 TELECENTRO SA 000001 40.059,28
01 - Nov - 26 NETFLIX 100001 0,00 12,99
05 - Oct - 26 SU PAGO EN PESOS -578.333,05
TOTAL CONSUMOS DE EJEMPLO 611.141,08
Impuestos, cargos e intereses
29 - Oct - 26 IMPUESTO DE SELLOS $ 7.333,69
`;

test("Visa Signature: el texto de una captura entra al mismo parser", () => {
  const parsed = parseCardStatement(normalizeOcrText(OCR_VISA));
  assert.equal(parsed.productName, "Tarjeta de Crédito VISA");
  assert.equal(parsed.closingDate, "2026-10-29");
  assert.equal(parsed.dueDate, "2026-11-11");
  assert.equal(parsed.nextClosing, "2026-11-26");
  assert.equal(parsed.nextDue, "2026-12-09");
  assert.equal(parsed.charges.length, 4);
  assert.equal(parsed.charges[0].description, "MERPAGO*SIMMONSBELMOYOLO");
  assert.equal(parsed.charges[0].installment_number, 9);
  assert.equal(parsed.charges[0].installment_count, 18);
  assert.equal(parsed.charges[0].amount, 75378.68);
  assert.equal(parsed.charges[1].description, "FARMACITY 68");
  assert.equal(parsed.charges[1].amount, 23399);
  assert.equal(parsed.charges[2].description, "TELECENTRO SA");
  assert.equal(parsed.charges[2].amount, 40059.28);
  assert.equal(parsed.charges[3].description, "NETFLIX");
  assert.equal(parsed.charges[3].currency, "USD");
  assert.equal(parsed.charges[3].amount, 12.99);
  const dumped = JSON.stringify(parsed.charges);
  assert.equal(dumped.includes("SU PAGO"), false);
  assert.equal(dumped.includes("IMPUESTO"), false);
});
