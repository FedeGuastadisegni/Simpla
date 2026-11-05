import test from "node:test";
import assert from "node:assert/strict";
import { ringPresentation } from "../ring-layout.js";

test("oculta la visualización cuando no hay categorías", () => {
  assert.equal(ringPresentation(0), "empty");
});

test("usa un indicador compacto para una categoría", () => {
  assert.equal(ringPresentation(1), "single");
});

test("mantiene el gráfico circular cuando hay varias categorías", () => {
  assert.equal(ringPresentation(2), "multiple");
  assert.equal(ringPresentation(4), "multiple");
});

test("trata cantidades inválidas como ausencia de categorías", () => {
  assert.equal(ringPresentation(-1), "empty");
  assert.equal(ringPresentation(1.5), "empty");
  assert.equal(ringPresentation(Number.NaN), "empty");
});
