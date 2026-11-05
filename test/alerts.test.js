import assert from "node:assert/strict";
import test from "node:test";
import { dueSoon, freshAlerts, markShown, readAlertPrefs, saveAlertPrefs } from "../alerts.js";

const memory = () => {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
};

test("la tarjeta avisa el cierre para cargar y el vencimiento para pagar", () => {
  const alerts = dueSoon({
    cards: [{ id: "visa", name: "Visa ejemplo", closing_day: 8, due_day: 10 }],
    services: [{ id: "luz", name: "Edenor" }],
    subscriptions: [],
  }, "2026-11-05", 3);
  assert.deepEqual(alerts.map((alert) => alert.text), ["Visa ejemplo cierra en 3 días"]);
  assert.equal(alerts[0].kind, "cierre");
  assert.equal(alerts[0].date, "2026-11-08");
});

test("hoy y mañana se dicen así, y una suscripción usa el día", () => {
  const alerts = dueSoon({
    cards: [{ id: "visa", name: "Visa", due_day: 6, closing_day: 5 }],
    services: [{ id: "luz", name: "Edenor", due_on: "2026-11-07" }],
    subscriptions: [{
      id: "netflix",
      name: "Netflix",
      frequency: "mensual",
      next_charge_on: "2026-11-07",
    }],
  }, "2026-11-05", 3);
  const byKind = Object.fromEntries(alerts.map((alert) => [alert.kind, alert.text]));
  assert.equal(byKind.cierre, "Visa cierra hoy");
  assert.equal(byKind.vencimiento, "Visa vence mañana");
  assert.equal(byKind.servicio, "Edenor vence en 2 días");
  assert.equal(byKind.suscripcion, "Netflix cobra el sábado");
});

test("sin fecha de servicio no se inventa un día", () => {
  const alerts = dueSoon({
    cards: [],
    services: [{ id: "luz", name: "Edenor" }],
    subscriptions: [{ id: "icloud", name: "iCloud", frequency: "anual", next_charge_on: "2026-11-01" }],
  }, "2026-11-05", 3);
  assert.equal(alerts.length, 0);
});

test("una alerta ya mostrada hoy no se repite", () => {
  const alerts = [{ id: "vence:visa:2026-11-08", text: "Visa vence en 3 días" }];
  const shown = markShown({}, alerts, "2026-11-05");
  assert.deepEqual(freshAlerts(alerts, shown, "2026-11-05"), []);
  assert.equal(freshAlerts(alerts, shown, "2026-11-06").length, 1);
});

test("los días de anticipación quedan entre 0 y 30", () => {
  const storage = memory();
  saveAlertPrefs({ enabled: false, daysAhead: 99 }, storage);
  assert.deepEqual(readAlertPrefs(storage), { enabled: false, daysAhead: 3 });
  saveAlertPrefs({ enabled: true, daysAhead: 1 }, storage);
  assert.equal(readAlertPrefs(storage).daysAhead, 1);
});
