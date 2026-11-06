// Exportar e importar. El archivo se arma y se lee en memoria.
// No incluye mail, tokens ni sesión. Los textos se sanean al importar.

import { redactLongNumbers } from "./privacy.js";

export const BACKUP_VERSION = 1;

export const TABLES = [
  "cards",
  "loans",
  "services",
  "service_bills",
  "subscriptions",
  "card_items",
  "expenses",
];

const FIELDS = {
  cards: ["id", "name", "due_day", "closing_day", "last_closing_on", "last_due_on", "next_closing_on", "next_due_on"],
  card_items: ["id", "card_id", "description", "amount", "currency", "spent_on", "installment_number", "installment_count", "statement_closes_on", "statement_due_on", "subscription_id", "service_bill_id"],
  loans: [
    "id", "name", "installment_amount", "remaining_installments", "ends_on",
    "amortization", "remaining_principal", "tem", "cft", "current_installment_bank", "adjust_bank",
  ],
  services: ["id", "name", "category", "card_id"],
  service_bills: ["id", "service_id", "period", "amount"],
  subscriptions: ["id", "name", "amount", "currency", "frequency", "next_charge_on", "on_card", "card_id"],
  expenses: ["id", "spent_on", "amount", "currency", "description", "category", "source"],
};

const TEXT_FIELDS = {
  cards: ["name"],
  card_items: ["description"],
  loans: ["name"],
  services: ["name"],
  service_bills: [],
  subscriptions: ["name"],
  expenses: ["description", "category"],
};

const LABELS = {
  cards: ["tarjeta", "tarjetas"],
  card_items: ["consumo", "consumos"],
  loans: ["préstamo", "préstamos"],
  services: ["servicio", "servicios"],
  service_bills: ["factura", "facturas"],
  subscriptions: ["suscripción", "suscripciones"],
  expenses: ["gasto", "gastos"],
};

function pick(row, fields) {
  const copy = {};
  for (const field of fields) {
    if (row[field] !== undefined) copy[field] = row[field];
  }
  return copy;
}

export function buildExport(tables, exportedAt) {
  const data = {};
  for (const table of TABLES) {
    data[table] = (tables[table] || []).map((row) => pick(row, FIELDS[table]));
  }
  return {
    version: BACKUP_VERSION,
    exported_at: exportedAt,
    data,
  };
}

export function summarize(data) {
  const parts = [];
  for (const table of TABLES) {
    const count = (data[table] || []).length;
    if (!count) continue;
    const [one, many] = LABELS[table];
    parts.push(`${count} ${count === 1 ? one : many}`);
  }
  return parts.join(", ");
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function validateImport(payload) {
  if (!isObject(payload)) return { ok: false, error: "El archivo no es un JSON de Simpla." };
  if (payload.version !== BACKUP_VERSION) return { ok: false, error: "Esa versión de backup no se puede leer." };
  if (!isObject(payload.data)) return { ok: false, error: "Faltan los datos." };
  const data = {};
  for (const table of TABLES) {
    const rows = payload.data[table] ?? [];
    if (!Array.isArray(rows)) return { ok: false, error: "El formato de las tablas no cierra." };
    data[table] = [];
    for (const row of rows) {
      if (!isObject(row) || typeof row.id !== "string" || row.id === "") {
        return { ok: false, error: "Hay una fila sin id." };
      }
      data[table].push(pick(row, FIELDS[table]));
    }
  }
  return { ok: true, data };
}

function redactRow(table, row) {
  const copy = { ...row };
  for (const field of TEXT_FIELDS[table]) {
    if (copy[field] != null) copy[field] = redactLongNumbers(copy[field]);
  }
  return copy;
}

export function planImport(payload, existing) {
  const parsed = validateImport(payload);
  if (!parsed.ok) return parsed;
  const ops = [];
  for (const table of TABLES) {
    const have = new Set((existing[table] || []).map((row) => row.id));
    for (const row of parsed.data[table]) {
      const clean = redactRow(table, row);
      ops.push({
        table,
        op: have.has(clean.id) ? "update" : "insert",
        row: clean,
      });
    }
  }
  return { ok: true, summary: summarize(parsed.data), ops };
}
