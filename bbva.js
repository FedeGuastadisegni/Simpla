// Resumen BBVA Mastercard, a partir del texto ya extraído.
// El PDF no entra acá. De este resultado solo se pueden guardar
// consumos confirmados y, si la persona lo pide, el día de cierre
// y el día de vencimiento. No se devuelve titular, domicilio, CUIT,
// cuenta, número de tarjeta ni caja de ahorro.
//
// Si ya hay un consumo con la misma tarjeta, fecha, monto, moneda,
// cuota y descripción saneada, no se inserta de nuevo. Se cuenta
// como salteado para avisar.

import { redactLongNumbers } from "./privacy.js";

const STOP = /^(impuestos y percepciones|cuotas a vencer)\b/i;
const CHARGE_START = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/;
const AMOUNT_AT_END = /(?:(USD|U\$S)\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})$/i;
const QUOTA = /\bC\.(\d{1,2})\/(\d{1,2})\b/i;

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function parseArAmount(raw) {
  const normalized = String(raw).trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return roundMoney(value);
}

function isoDate(day, month, year) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function labeledDate(text, label) {
  const match = new RegExp(`${label}\\s*:\\s*(\\d{2})/(\\d{2})/(\\d{4})`, "i").exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const iso = isoDate(day, month, year);
  if (!iso) return null;
  return { day, iso };
}

function labeledAmount(text, label) {
  const match = new RegExp(`${label}\\s*:\\s*(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})`, "i").exec(text);
  if (!match) return null;
  return parseArAmount(match[1]);
}

export function foldName(value) {
  return String(value ?? "")
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function brandOf(name) {
  if (name.includes("mastercard")) return "mastercard";
  if (name.includes("visa")) return "visa";
  if (name.includes("amex") || name.includes("american express")) return "amex";
  return "";
}

function bankOf(name) {
  if (name.includes("bbva")) return "bbva";
  return "";
}

function productName(lines) {
  const head = [];
  for (const line of lines) {
    if (STOP.test(line) || /^detalle de consumos\b/i.test(line)) break;
    head.push(line);
  }
  const blob = foldName(head.join(" "));
  const bank = blob.includes("bbva") ? "BBVA" : "";
  let brand = "";
  if (blob.includes("mastercard")) brand = "Mastercard";
  else if (/\bvisa\b/.test(blob)) brand = "Visa";
  else if (blob.includes("amex") || blob.includes("american express")) brand = "Amex";
  return [bank, brand].filter(Boolean).join(" ") || "Tarjeta";
}

export function matchCard(cards, suggestedName) {
  const target = foldName(suggestedName);
  if (!target) return null;
  const targetBrand = brandOf(target);
  const targetBank = bankOf(target);
  let loose = null;
  for (const card of cards) {
    const name = foldName(card.name);
    if (!name) continue;
    if (name === target) return card;
    const cardBrand = brandOf(name);
    const cardBank = bankOf(name);
    if (targetBrand && cardBrand && targetBrand !== cardBrand) continue;
    if (targetBank && cardBank && targetBank !== cardBank) continue;
    if (targetBank && cardBank === targetBank && targetBrand && cardBrand === targetBrand) return card;
    const contains = name.includes(target) || target.includes(name);
    if (contains && (!targetBrand || !cardBrand || cardBrand === targetBrand)) loose = loose || card;
  }
  return loose;
}

function parseCharge(line) {
  const start = CHARGE_START.exec(line);
  if (!start) return null;
  const day = Number(start[1]);
  const month = Number(start[2]);
  const year = Number(start[3]);
  const spentOn = isoDate(day, month, year);
  if (!spentOn) return null;
  const rest = start[4].trim();
  const amountMatch = AMOUNT_AT_END.exec(rest);
  if (!amountMatch) return null;
  const amount = parseArAmount(amountMatch[2]);
  if (amount == null) return null;
  let description = rest.slice(0, amountMatch.index).trim();
  let installmentNumber = null;
  let installmentCount = null;
  const quota = QUOTA.exec(description);
  if (quota) {
    installmentNumber = Number(quota[1]);
    installmentCount = Number(quota[2]);
    if (installmentNumber < 1 || installmentCount < 1 || installmentNumber > installmentCount) return null;
    description = `${description.slice(0, quota.index)} ${description.slice(quota.index + quota[0].length)}`.replace(/\s+/g, " ").trim();
  }
  if (!description) return null;
  const currency = /USD|U\$S/i.test(rest) ? "USD" : "ARS";
  return {
    spent_on: spentOn,
    description,
    amount,
    currency,
    installment_number: installmentNumber,
    installment_count: installmentCount,
    selected: true,
  };
}

export function parseBbvaStatement(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const source = lines.join("\n");
  const closing = labeledDate(source, "Fecha de cierre");
  const due = labeledDate(source, "Fecha de vencimiento");
  const nextClosing = labeledDate(source, "Pr[oó]ximo cierre");
  const nextDue = labeledDate(source, "Pr[oó]ximo vencimiento");
  const charges = [];
  let stopped = false;
  for (const line of lines) {
    if (STOP.test(line)) {
      stopped = true;
      continue;
    }
    if (stopped) continue;
    const charge = parseCharge(line);
    if (charge) charges.push(charge);
  }
  return {
    productName: productName(lines),
    closingDay: closing?.day ?? null,
    closingDate: closing?.iso ?? null,
    dueDay: due?.day ?? null,
    dueDate: due?.iso ?? null,
    nextClosing: nextClosing?.iso ?? null,
    nextDue: nextDue?.iso ?? null,
    balanceARS: labeledAmount(source, "Saldo en \\$"),
    balanceUSD: labeledAmount(source, "Saldo en U\\$S"),
    charges,
  };
}

function cleanCharge(row, cardId) {
  const description = redactLongNumbers(String(row.description ?? "").trim());
  const amount = roundMoney(row.amount);
  const currency = row.currency === "USD" ? "USD" : "ARS";
  const spentOn = String(row.spent_on ?? "").slice(0, 10);
  let installmentNumber = row.installment_number == null || row.installment_number === "" ? null : Number(row.installment_number);
  let installmentCount = row.installment_count == null || row.installment_count === "" ? null : Number(row.installment_count);
  if (!description) return { ok: false, error: "Hay un consumo sin descripción." };
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Hay un monto que no cierra." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return { ok: false, error: "Hay una fecha que no cierra." };
  if (installmentNumber == null && installmentCount == null) {
    installmentNumber = null;
    installmentCount = null;
  } else if (!Number.isInteger(installmentNumber) || !Number.isInteger(installmentCount) || installmentNumber < 1 || installmentCount < 1 || installmentNumber > installmentCount) {
    return { ok: false, error: "Completá la cuota actual y el total, o dejá los dos vacíos." };
  }
  return {
    ok: true,
    row: {
      card_id: cardId,
      description,
      amount,
      currency,
      spent_on: spentOn,
      installment_number: installmentNumber,
      installment_count: installmentCount,
    },
  };
}

function samePurchase(left, right) {
  return left.card_id === right.card_id
    && left.description === right.description
    && left.amount === right.amount
    && left.currency === right.currency;
}

// Una cuota es la misma compra cuando el resumen siguiente trae la
// cuota de adelante. Coincide tarjeta, descripción saneada, monto,
// moneda y cantidad de cuotas. Si el número nuevo es el guardado + 1,
// es el paso normal. Si la serie ya existe y el número es mayor, también
// es la misma compra (un resumen salteado). Si el guardado ya va más
// adelante, no se retrocede. Un pago sin cuotas coincide además por fecha.
function matchExistingCharge(incoming, pool) {
  const candidates = pool.filter((item) => samePurchase(item, incoming));
  if (incoming.installment_number == null) {
    const hit = candidates.find((item) => item.installment_number == null && String(item.spent_on).slice(0, 10) === incoming.spent_on);
    if (!hit) return null;
    return { kind: "loaded", item: hit, reason: "Mismo pago, misma fecha." };
  }
  const series = candidates.filter((item) => item.installment_number != null && Number(item.installment_count) === incoming.installment_count);
  const exact = series.find((item) => Number(item.installment_number) === incoming.installment_number);
  if (exact) {
    return { kind: "loaded", item: exact, reason: `La cuota ${incoming.installment_number}/${incoming.installment_count} ya está.` };
  }
  const earlier = series
    .filter((item) => Number(item.installment_number) < incoming.installment_number)
    .sort((a, b) => Number(b.installment_number) - Number(a.installment_number));
  if (earlier.length) {
    const current = Number(earlier[0].installment_number);
    const step = current + 1 === incoming.installment_number ? "la que sigue" : "la misma compra";
    return {
      kind: "update",
      item: earlier[0],
      reason: `Es ${step}: estaba en ${current}/${incoming.installment_count} y pasa a ${incoming.installment_number}/${incoming.installment_count}.`,
    };
  }
  const later = series
    .filter((item) => Number(item.installment_number) > incoming.installment_number)
    .sort((a, b) => Number(a.installment_number) - Number(b.installment_number));
  if (later.length) {
    const current = Number(later[0].installment_number);
    return {
      kind: "loaded",
      item: later[0],
      reason: `Ya está en la cuota ${current}/${incoming.installment_count}, más adelante que este resumen.`,
    };
  }
  return null;
}

export function reviewSummary(inserts, known, ignored, updates) {
  const loaded = updates > 0 ? `${known} ya cargados (se actualiza cuota)` : `${known} ya cargados`;
  return `${inserts} nuevos · ${loaded} · ${ignored} ignorados`;
}

export function planStatementImport(rows, cardId, existing) {
  const pool = (existing || [])
    .filter((row) => row.card_id === cardId)
    .map((row) => {
      const cleaned = cleanCharge(row, cardId);
      return cleaned.ok ? { ...cleaned.row, id: row.id, created_at: row.created_at } : null;
    })
    .filter(Boolean);
  const planned = [];
  const inserts = [];
  const updates = [];
  let loaded = 0;
  let ignored = 0;
  for (const row of rows) {
    const cleaned = cleanCharge(row, cardId);
    if (!cleaned.ok) return cleaned;
    const selected = row.selected !== false;
    const match = matchExistingCharge(cleaned.row, pool);
    if (match && String(match.item.id).startsWith("batch-")) {
      planned.push({ ...cleaned.row, status: "loaded", reason: "Se repite en este resumen.", selected: false, existingId: null });
      loaded += 1;
      continue;
    }
    if (!selected && (!match || match.kind === "update")) {
      planned.push({ ...cleaned.row, status: "ignored", reason: "Destildado.", selected: false, existingId: match?.item.id ?? null });
      ignored += 1;
      continue;
    }
    if (!match) {
      const id = `batch-${planned.length}`;
      pool.push({ ...cleaned.row, id });
      planned.push({ ...cleaned.row, status: "new", reason: "No está cargado.", selected: true, existingId: null });
      inserts.push(cleaned.row);
      continue;
    }
    if (match.kind === "update" && selected) {
      planned.push({ ...cleaned.row, status: "update", reason: match.reason, selected: true, existingId: match.item.id });
      updates.push({ ...cleaned.row, existingId: match.item.id });
      match.item.installment_number = cleaned.row.installment_number;
      match.item.spent_on = cleaned.row.spent_on;
      continue;
    }
    planned.push({ ...cleaned.row, status: "loaded", reason: match.reason, selected: false, existingId: match.item.id });
    loaded += 1;
  }
  const known = loaded + updates.length;
  return {
    ok: true,
    rows: planned,
    inserts,
    updates,
    loaded,
    ignored,
    summary: reviewSummary(inserts.length, known, ignored, updates.length),
  };
}
