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

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("simpla", 1);
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

export async function queueChange(table, op, row) {
  if (!TABLES.includes(table)) throw new Error("Tabla desconocida");
  if (op !== "insert" && op !== "update" && op !== "delete") {
    throw new Error("Operación desconocida");
  }
  const rowId = row.id;
  if (!rowId) throw new Error("Falta el id");

  const db = await openDatabase();
  const transaction = db.transaction([table, "outbox"], "readwrite");
  const store = transaction.objectStore(table);
  if (op === "delete") store.delete(rowId);
  else store.put(row);
  transaction.objectStore("outbox").add({
    table,
    op,
    rowId,
    row: op === "delete" ? null : row,
    queuedAt: new Date().toISOString(),
  });
  await transactionDone(transaction);
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
      result = await client.from(item.table).insert(item.row);
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

export async function syncNow(client) {
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
  } catch (error) {
    const pending = await pendingCount();
    renderStatus(pending ? "pending" : "offline");
  }
}

export function startData(client) {
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
