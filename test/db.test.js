import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

let instance = 0;
async function store(online = true) {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: online } });
  globalThis.document = { getElementById: () => null };
  return import(`../db.js?instance=${++instance}`);
}

test("una revisión se guarda en una sola transacción y emite una sola sincronización", async () => {
  const db = await store();
  let events = 0;
  let syncs = 0;
  db.onData(() => { events += 1; });
  db.bindSync(() => { syncs += 1; });
  await db.queueChanges([
    { table: "services", op: "insert", row: { id: "service" } },
    { table: "service_bills", op: "insert", row: { id: "bill", service_id: "service" } },
    { table: "card_items", op: "insert", row: { id: "charge", service_bill_id: "bill" } },
  ]);
  assert.equal(events, 1);
  assert.equal(syncs, 1);
  assert.equal(await db.pendingCount(), 3);
  assert.equal((await db.listRows("services"))[0].id, "service");
  assert.equal((await db.listRows("card_items"))[0].service_bill_id, "bill");
});

test("una fila inválida revierte toda la revisión sin dejar entidades ni cola parcial", async () => {
  const db = await store();
  await assert.rejects(db.queueChanges([
    { table: "services", op: "insert", row: { id: "service" } },
    { table: "card_items", op: "insert", row: { id: "charge", invalid: () => {} } },
  ]));
  assert.equal((await db.listRows("services")).length, 0);
  assert.equal((await db.listRows("card_items")).length, 0);
  assert.equal(await db.pendingCount(), 0);
});

test("las sincronizaciones se serializan y recogen cambios añadidos durante el envío", async () => {
  const db = await store();
  const remote = new Map();
  const sent = [];
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const client = { from(table) { return {
    async upsert(row) {
      sent.push(row.id);
      if (row.id === "first") { started(); await gate; }
      if (!remote.has(table)) remote.set(table, []);
      remote.get(table).push(row);
      return { error: null };
    },
    async select() { return { data: remote.get(table) || [], error: null }; },
  }; } };
  await db.queueChange("cards", "insert", { id: "first" });
  const running = db.syncNow(client);
  await entered;
  db.bindSync(() => { db.syncNow(client); });
  await db.queueChange("cards", "insert", { id: "second" });
  assert.equal(db.syncNow(client), running);
  release();
  await running;
  assert.deepEqual(sent, ["first", "second"]);
  assert.equal(await db.pendingCount(), 0);
  assert.equal((await db.listRows("cards")).length, 2);
});

test("sin conexión la revisión queda completa en la cola", async () => {
  const db = await store(false);
  await db.queueChanges([
    { table: "subscriptions", op: "insert", row: { id: "sub" } },
    { table: "card_items", op: "insert", row: { id: "charge", subscription_id: "sub" } },
  ]);
  await db.syncNow({ from() { throw new Error("No debe acceder a la red"); } });
  assert.equal(await db.pendingCount(), 2);
  assert.equal((await db.listRows("subscriptions")).length, 1);
});

test("reintentar un alta cuya respuesta se perdió no duplica ni traba la cola", async () => {
  const db = await store();
  const remote = new Map();
  let calls = 0;
  const client = { from(table) { return {
    async upsert(row, options) {
      assert.deepEqual(options, { onConflict: "id", ignoreDuplicates: true });
      if (!remote.has(table)) remote.set(table, new Map());
      if (!remote.get(table).has(row.id)) remote.get(table).set(row.id, row);
      calls += 1;
      return calls === 1 ? { error: new Error("Respuesta perdida") } : { error: null };
    },
    async select() { return { data: [...(remote.get(table)?.values() || [])], error: null }; },
  }; } };
  await db.queueChange("cards", "insert", { id: "card" });
  await db.syncNow(client);
  assert.equal(await db.pendingCount(), 1);
  await db.syncNow(client);
  assert.equal(await db.pendingCount(), 0);
  assert.equal(remote.get("cards").size, 1);
});
