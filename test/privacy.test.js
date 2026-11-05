import assert from "node:assert/strict";
import test from "node:test";
import { redactLongNumbers } from "../privacy.js";

test("reemplaza 8 dígitos seguidos", () => {
  assert.equal(redactLongNumbers("visa 12345678"), "visa ••••");
});

test("reemplaza números con espacios", () => {
  assert.equal(redactLongNumbers("4532 1234 5678 9012"), "••••");
});

test("reemplaza números con guiones", () => {
  assert.equal(redactLongNumbers("4532-1234-5678-9012"), "••••");
});

test("mezcla espacios y guiones en una sola seguidilla", () => {
  assert.equal(redactLongNumbers("1234 5678-9012"), "••••");
});

test("no toca menos de 8 dígitos", () => {
  assert.equal(redactLongNumbers("cuota 12"), "cuota 12");
  assert.equal(redactLongNumbers("1234567"), "1234567");
  assert.equal(redactLongNumbers("1234 567"), "1234 567");
});

test("deja el texto alrededor y separa dos números", () => {
  assert.equal(redactLongNumbers("visa 1234 5678 fin"), "visa •••• fin");
  assert.equal(redactLongNumbers("11111111 y 22222222"), "•••• y ••••");
});

test("no usa el punto como separador de la seguidilla", () => {
  assert.equal(redactLongNumbers("total 100.000"), "total 100.000");
});
