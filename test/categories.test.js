import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES, categoryLabel } from "../planes.js";

test("las categorías de servicios son las de Federico", () => {
  assert.deepEqual(CATEGORIES.map(([, label]) => label), [
    "Luz",
    "Gas",
    "Agua",
    "Municipal",
    "ARBA",
    "Internet",
    "Línea de celular",
    "Seguro auto",
  ]);
  assert.equal(CATEGORIES.some(([value]) => value === "otro"), false);
});

test("celular viejo se muestra como línea de celular", () => {
  assert.equal(categoryLabel("celular"), "Línea de celular");
  assert.equal(categoryLabel("linea_celular"), "Línea de celular");
  assert.equal(categoryLabel("luz"), "Luz");
  assert.equal(categoryLabel("otro"), "Otro");
});
