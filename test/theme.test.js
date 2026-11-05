import assert from "node:assert/strict";
import test from "node:test";
import { applyTheme, readTheme, saveTheme } from "../theme.js";

test("el tema automático no pisa el del sistema", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  const root = { dataset: {} };
  saveTheme("dark", storage);
  applyTheme(readTheme(storage), root);
  assert.equal(root.dataset.theme, "dark");
  saveTheme("auto", storage);
  applyTheme(readTheme(storage), root);
  assert.equal(root.dataset.theme, undefined);
  assert.equal(readTheme(storage), "auto");
});
