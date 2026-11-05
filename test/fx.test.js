import assert from "node:assert/strict";
import test from "node:test";
import { arsFor, formatQuoteDate, fxParts, normalizeQuote, readFxCache, refreshFx, writeFxCache } from "../fx.js";

// EJEMPLO. Cotizaciones inventadas para el test: no se consulta la red.
const BOLSA = { venta: 1450, fecha: "2026-11-05T15:00:00.000Z" };
const TARJETA = { venta: 1600, fecha: "2026-11-05T15:00:00.000Z" };

test("EJEMPLO cotización: 20 USD son 29.000 al MEP y 32.000 tarjeta", () => {
  assert.equal(arsFor(20, 1450), 29000);
  assert.equal(arsFor(20, 1600), 32000);
  assert.equal(arsFor(9.99, 1450), 14485.5);
  assert.equal(arsFor(9.99, 1600), 15984);
  const parts = fxParts(20, { bolsa: BOLSA, tarjeta: TARJETA });
  assert.equal(parts.mep, 29000);
  assert.equal(parts.tarjeta, 32000);
  assert.equal(formatQuoteDate(parts.fecha).includes("2026"), true);
});

test("sin venta no hay conversión", () => {
  assert.equal(arsFor(20, 0), null);
  assert.equal(normalizeQuote({ compra: 10 }), null);
  assert.equal(normalizeQuote({ venta: 1450, fechaActualizacion: "2026-11-05T15:00:00.000Z" }).venta, 1450);
});

test("si la red falla, queda la última cotización guardada", async () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  writeFxCache({
    bolsa: BOLSA,
    tarjeta: TARJETA,
    fetchedAt: "2026-11-05T15:00:00.000Z",
  }, storage);
  const saved = readFxCache(storage);
  assert.equal(saved.bolsa.venta, 1450);
  const result = await refreshFx(async () => {
    throw new Error("sin red");
  }, storage);
  assert.equal(result.fresh, false);
  assert.equal(result.bolsa.venta, 1450);
  assert.equal(result.tarjeta.venta, 1600);
});
