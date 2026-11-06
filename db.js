// Copia local. Los montos en USD se guardan y se leen en USD: no se convierten a pesos.

const TABLES = [
  "cards",
  "card_items",
  "loans",
  "services",
  "service_bills",
  "subscriptions",
  "expenses",
];

const LABELS = {
  synced: "Sincronizado",
  offline: "Sin conexión",
  pending: "Cambios pendientes",
};

let databasePromise = null;
let listening = false;
let databaseName = "simpla";
let enqueue = true;
let syncHook = null;
let syncRunning = null;
let syncAgain = false;
const listeners = new Set();

export function bindSync(fn) {
  syncHook = fn;
}

export function useLocalDemoStore() {
  databaseName = "simpla-demo";
  enqueue = false;
  databasePromise = null;
}

export function onData(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  }
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const table of TABLES) {
        if (!db.objectStoreNames.contains(table)) {
          db.createObjectStore(table, { keyPath: "id" });
        }
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
  });
  return databasePromise;
}

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("transacción abortada"));
  });
}

async function readAll(table) {
  const db = await openDatabase();
  const transaction = db.transaction(table, "readonly");
  const rows = await requestDone(transaction.objectStore(table).getAll());
  await transactionDone(transaction);
  return rows;
}

export function renderStatus(state) {
  const root = document.getElementById("sync-status");
  const label = document.getElementById("sync-label");
  if (!root || !label || !LABELS[state]) return;
  root.dataset.state = state;
  label.textContent = LABELS[state];
}

export async function pendingCount() {
  const rows = await readAll("outbox");
  return rows.length;
}

export async function listRows(table) {
  return readAll(table);
}

export async function queueChange(table, op, row) {
  return queueChanges([{ table, op, row }]);
}

export async function queueChanges(operations) {
  if (!operations.length) return;
  for (const { table, op, row } of operations) {
    if (!TABLES.includes(table)) throw new Error("Tabla desconocida");
    if (!["insert", "update", "delete"].includes(op)) throw new Error("Operación desconocida");
    if (!row.id) throw new Error("Falta el id");
  }
  const db = await openDatabase();
  const stores = [...new Set(operations.map((item) => item.table))];
  if (enqueue) stores.push("outbox");
  const transaction = db.transaction(stores, "readwrite");
  const done = transactionDone(transaction);
  try {
    for (const { table, op, row } of operations) {
      const store = transaction.objectStore(table);
      if (op === "delete") store.delete(row.id);
      else store.put(row);
      if (enqueue) transaction.objectStore("outbox").add({
        table, op, rowId: row.id, row: op === "delete" ? null : row,
        queuedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    transaction.abort();
    await done.catch(() => {});
    throw error;
  }
  await done;
  emit();
  if (enqueue && syncHook) syncHook();
}

async function removeOutbox(id) {
  const db = await openDatabase();
  const transaction = db.transaction("outbox", "readwrite");
  transaction.objectStore("outbox").delete(id);
  await transactionDone(transaction);
}

async function pushOutbox(client) {
  const items = await readAll("outbox");
  items.sort((a, b) => a.id - b.id);
  for (const item of items) {
    let result;
    if (item.op === "delete") {
      result = await client.from(item.table).delete().eq("id", item.rowId);
    } else if (item.op === "update") {
      result = await client.from(item.table).update(item.row).eq("id", item.rowId);
    } else {
      // Un reintento tras perder la respuesta no vuelve a insertar ni pisa otra versión.
      result = await client.from(item.table).upsert(item.row, { onConflict: "id", ignoreDuplicates: true });
    }
    if (result.error) throw result.error;
    await removeOutbox(item.id);
  }
}

async function mergeServerRows(table, serverRows) {
  const outbox = await readAll("outbox");
  const pendingIds = new Set(
    outbox.filter((item) => item.table === table).map((item) => item.rowId)
  );
  const serverIds = new Set(serverRows.map((row) => row.id));
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(table, "readwrite");
    const store = transaction.objectStore(table);
    const request = store.getAll();
    request.onsuccess = () => {
      for (const row of request.result) {
        if (!serverIds.has(row.id) && !pendingIds.has(row.id)) store.delete(row.id);
      }
      for (const row of serverRows) {
        if (!pendingIds.has(row.id)) store.put(row);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("transacción abortada"));
  });
}

async function pullAll(client) {
  for (const table of TABLES) {
    const { data, error } = await client.from(table).select("*");
    if (error) throw error;
    await mergeServerRows(table, data || []);
  }
}

async function syncCycle(client) {
  if (!enqueue) return;
  const pendingBefore = await pendingCount();
  if (!navigator.onLine) {
    renderStatus(pendingBefore ? "pending" : "offline");
    return;
  }
  try {
    await pushOutbox(client);
    await pullAll(client);
    const pending = await pendingCount();
    renderStatus(pending ? "pending" : "synced");
    emit();
  } catch (error) {
    const pending = await pendingCount();
    renderStatus(pending ? "pending" : "offline");
  }
}

export function syncNow(client) {
  syncAgain = true;
  if (syncRunning) return syncRunning;
  syncRunning = (async () => {
    do {
      syncAgain = false;
      await syncCycle(client);
    } while (syncAgain && navigator.onLine);
  })().finally(() => { syncRunning = null; });
  return syncRunning;
}

export function startData(client) {
  bindSync(() => {
    syncNow(client);
  });
  if (!listening) {
    listening = true;
    window.addEventListener("online", () => {
      syncNow(client);
    });
    window.addEventListener("offline", async () => {
      const pending = await pendingCount();
      renderStatus(pending ? "pending" : "offline");
    });
  }
  return syncNow(client);
}
