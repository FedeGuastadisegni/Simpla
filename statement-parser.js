// Resúmenes de tarjeta, a partir del texto ya extraído.
// Mastercard trae la fecha como dd/mm/aaaa en la misma línea.
// Visa trae dd-Mon-aa (Abr, Ago, Dic). En el PDF cada columna
// llega en su propia línea; una captura suele traer la fila entera.
// El PDF no entra acá. De este resultado solo se pueden guardar
// consumos confirmados y, si la persona lo pide, el día de cierre
// y el día de vencimiento. No se devuelve titular, domicilio, CUIT,
// cuenta, número de tarjeta ni caja de ahorro.
//
// Si ya hay un consumo de esa tarjeta con el mismo comercio, monto
// y moneda, no se inserta de nuevo. La fecha puede ser la misma o
// cercana (mismo mes, o hasta 21 días): un alta a mano se vincula
// y se actualiza con la fecha y la cuota del resumen. Una cuota
// que pasa de N/T a (N+1)/T actualiza la misma fila.

import { redactLongNumbers } from "./privacy.js";
import { parseIsoDate } from "./card-math.js";

const STOP = /^(impuestos\b|cuotas a vencer\b)/i;
const TOTAL_CONSUMOS = /^total consumos\b/i;
const CHARGE_START = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/;
const VISA_DATE_ONLY = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/;
const VISA_CHARGE_START = /^(\d{2})-([A-Za-z]{3})-(\d{2})\s+(.+)$/;
const AMOUNT_AT_END = /(?:(USD|U\$S)\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})$/i;
const AMOUNT_LINE = /^-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/;
const VISA_TAIL = /^(.*?)(?:\s+(\d{6})(?!\d))?\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?:\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}))?$/;
const QUOTA = /\bC\.(\d{1,2})\/(\d{1,2})\b/i;
const MONTHS = {
  jan: 1, ene: 1,
  feb: 2,
  mar: 3,
  apr: 4, abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8, ago: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12, dic: 12,
};

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

function parseDMonYy(token) {
  const match = VISA_DATE_ONLY.exec(String(token ?? "").trim());
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const day = Number(match[1]);
  const year = 2000 + Number(match[3]);
  const iso = isoDate(day, month, year);
  if (!iso) return null;
  return { day, iso };
}

// pdf.js parte «PRÓXIMO» en «PR» / «Ó» / «XIMO …». La etiqueta
// queda en la línea «XIMO CIERRE» y la fecha en la siguiente.
function visaLabelDate(lines, labels) {
  for (let i = 0; i < lines.length; i++) {
    for (const label of labels) {
      const same = new RegExp(`^${label}\\s*:?\\s*(\\d{2}-[A-Za-z]{3}-\\d{2})$`, "i").exec(lines[i]);
      if (same) {
        const parsed = parseDMonYy(same[1]);
        if (parsed) return parsed;
      }
      if (new RegExp(`^${label}\\s*:?$`, "i").test(lines[i])) {
        const parsed = parseDMonYy(lines[i + 1] || "");
        if (parsed) return parsed;
      }
    }
  }
  return null;
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

function productName(lines) {
  const head = [];
  for (const line of lines) {
    if (STOP.test(line) || /^detalle de consumos\b/i.test(line)) break;
    head.push(line);
  }
  const blob = foldName(head.join(" "));
  let brand = "";
  if (blob.includes("mastercard")) brand = "MasterCard";
  else if (/\bvisa\b/.test(blob)) brand = "VISA";
  else if (blob.includes("amex") || blob.includes("american express")) brand = "Amex";
  return brand ? `Tarjeta de Crédito ${brand}` : "Tarjeta de Crédito";
}

export function matchCard(cards, suggestedName) {
  const target = foldName(suggestedName);
  if (!target) return null;
  const targetBrand = brandOf(target);
  const exact = cards.filter((card) => foldName(card.name) === target);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const candidates = cards.filter((card) => {
    const name = foldName(card.name);
    if (!name) return false;
    const cardBrand = brandOf(name);
    if (targetBrand && cardBrand && targetBrand !== cardBrand) return false;
    const contains = name.includes(target) || target.includes(name);
    return contains || Boolean(targetBrand && cardBrand === targetBrand);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function buildCharge(spentOn, description, amount, currency) {
  let installmentNumber = null;
  let installmentCount = null;
  const quota = QUOTA.exec(description);
  if (quota) {
    installmentNumber = Number(quota[1]);
    installmentCount = Number(quota[2]);
    if (installmentNumber < 1 || installmentCount < 1 || installmentNumber > installmentCount) return null;
    description = `${description.slice(0, quota.index)} ${description.slice(quota.index + quota[0].length)}`.replace(/\s+/g, " ").trim();
  }
  if (!description || amount == null) return null;
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

function parseVisaCharge(line) {
  const start = VISA_CHARGE_START.exec(line);
  if (!start) return null;
  const spent = parseDMonYy(`${start[1]}-${start[2]}-${start[3]}`);
  if (!spent) return null;
  const rest = start[4].trim();
  if (/^su pago\b/i.test(rest) || /-\s*\d[\d.]*,\d{2}/.test(rest)) return null;
  const tail = VISA_TAIL.exec(rest);
  if (!tail) return null;
  const pesos = parseArAmount(tail[3]);
  const dolares = tail[4] ? parseArAmount(tail[4]) : null;
  if (pesos == null) return null;
  let amount = pesos;
  let currency = "ARS";
  if (dolares != null && dolares > 0 && !(pesos > 0)) {
    amount = dolares;
    currency = "USD";
  }
  if (!(amount > 0)) return null;
  return buildCharge(spent.iso, tail[1].trim(), amount, currency);
}

function parseCharge(line) {
  const start = CHARGE_START.exec(line);
  if (!start) return parseVisaCharge(line);
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
  const description = rest.slice(0, amountMatch.index).trim();
  const currency = /USD|U\$S/i.test(rest) ? "USD" : "ARS";
  return buildCharge(spentOn, description, amount, currency);
}

// El texto del PDF trae fecha, comercio, cupón y monto en líneas
// separadas. Las junta para pasar por el mismo parser que la captura.
function mergeVisaTable(lines) {
  const out = [];
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^fecha$/i.test(line) || /^consumos\b/i.test(line)) inTable = true;
    if (!inTable || !VISA_DATE_ONLY.test(line)) {
      out.push(line);
      continue;
    }
    const description = lines[i + 1];
    if (!description || VISA_DATE_ONLY.test(description) || AMOUNT_LINE.test(description) || /^(fecha|pesos|d[oó]lares|total\b|impuestos\b)/i.test(description)) {
      out.push(line);
      continue;
    }
    let cursor = i + 2;
    const parts = [line, description];
    if (/^\d{6}$/.test(lines[cursor] || "")) {
      parts.push(lines[cursor]);
      cursor += 1;
    }
    if (!AMOUNT_LINE.test(lines[cursor] || "")) {
      out.push(line);
      continue;
    }
    parts.push(lines[cursor]);
    cursor += 1;
    if (AMOUNT_LINE.test(lines[cursor] || "")) {
      parts.push(lines[cursor]);
      cursor += 1;
    }
    out.push(parts.join(" "));
    i = cursor - 1;
  }
  return out;
}

export function normalizeOcrText(raw) {
  let text = String(raw ?? "").replace(/\u00a0/g, " ");
  text = text.replace(/(\d)\s*\/\s*(?=\d)/g, "$1/");
  text = text.replace(/(\d{2})\s*-\s*([A-Za-z]{3})\s*-\s*(\d{2})\b/g, "$1-$2-$3");
  text = text.replace(/C\s*\.\s*(\d{1,2}\/\d{1,2})/gi, "C.$1");
  text = text.replace(/[ \t]*\r?\n[ \t]*/g, "\n");
  text = text.replace(/(?<=\S)[ \t]+(?=\d{2}\/\d{2}\/\d{4}\b)/g, "\n");
  text = text.replace(/(?<=\S)[ \t]+(?=\d{2}-[A-Za-z]{3}-\d{2}\b)/g, "\n");
  return text;
}

export function parseCardStatement(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const source = lines.join("\n");
  const closing = labeledDate(source, "Fecha de cierre") || visaLabelDate(lines, ["CIERRE ACTUAL"]);
  const due = labeledDate(source, "Fecha de vencimiento") || visaLabelDate(lines, ["VENCIMIENTO ACTUAL"]);
  const nextClosing = labeledDate(source, "Pr[oó]ximo cierre") || visaLabelDate(lines, ["PR[OÓ]XIMO CIERRE", "XIMO CIERRE"]);
  const nextDue = labeledDate(source, "Pr[oó]ximo vencimiento") || visaLabelDate(lines, ["PR[OÓ]XIMO VENCIMIENTO", "XIMO VENCIMIENTO"]);
  const charges = [];
  let stopped = false;
  for (const line of mergeVisaTable(lines)) {
    if (STOP.test(line) || (charges.length > 0 && TOTAL_CONSUMOS.test(line))) {
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || !parseIsoDate(spentOn)) return { ok: false, error: "Hay una fecha que no cierra." };
  const period = {};
  for (const field of ["statement_closes_on", "statement_due_on"]) {
    if (row[field] == null || row[field] === "") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row[field]) || !parseIsoDate(row[field])) {
      return { ok: false, error: "Revisá el cierre y el vencimiento del resumen." };
    }
    period[field] = row[field];
  }
  if (period.statement_closes_on && (!period.statement_due_on || period.statement_due_on < period.statement_closes_on)) {
    return { ok: false, error: "El vencimiento debe ser igual o posterior al cierre." };
  }
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
      ...period,
    },
  };
}

const NEAR_DAYS = 21;
const DAY_MS = 86400000;

function merchantsMatch(left, right) {
  const a = foldName(left);
  const b = foldName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  return long.startsWith(`${short} `);
}

function sameMoney(left, right) {
  return left.card_id === right.card_id
    && left.currency === right.currency
    && roundMoney(left.amount) === roundMoney(right.amount)
    && merchantsMatch(left.description, right.description);
}

function dateDistance(left, right) {
  const a = Date.parse(`${String(left).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(right).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / DAY_MS;
}

function datesClose(left, right) {
  const a = String(left).slice(0, 10);
  const b = String(right).slice(0, 10);
  if (a === b) return "exact";
  if (a.slice(0, 7) === b.slice(0, 7)) return "month";
  const distance = dateDistance(a, b);
  if (distance != null && distance <= NEAR_DAYS) return "near";
  return null;
}

function closest(items, incoming) {
  return [...items].sort((a, b) => dateDistance(a.spent_on, incoming.spent_on) - dateDistance(b.spent_on, incoming.spent_on))[0];
}

function writtenByHand(stored, incoming) {
  return stored.description !== incoming.description
    || String(stored.spent_on).slice(0, 10) !== incoming.spent_on
    || (stored.installment_number == null && incoming.installment_number != null);
}

const HAND_REASON = "Se vinculó con un consumo que cargaste a mano.";

function periodMatch(stored, incoming) {
  return !stored.statement_due_on || !incoming.statement_due_on
    || stored.statement_due_on.slice(0, 7) === incoming.statement_due_on.slice(0, 7);
}

function confirmPeriod(stored, incoming) {
  if (!incoming.statement_due_on) return null;
  if (stored.statement_due_on && stored.statement_due_on > incoming.statement_due_on) {
    return { kind: "loaded", item: stored, reason: "Ya tiene un período posterior confirmado." };
  }
  if (stored.statement_due_on !== incoming.statement_due_on || stored.statement_closes_on !== incoming.statement_closes_on) {
    return { kind: "link", item: stored, reason: "Se confirmó el período de pago de este consumo." };
  }
  return null;
}

function exactCopy(item, incoming) {
  return sameMoney(item, incoming)
    && String(item.spent_on).slice(0, 10) === incoming.spent_on
    && (item.installment_number ?? null) === (incoming.installment_number ?? null)
    && (item.installment_count ?? null) === (incoming.installment_count ?? null);
}

// Una cuota es la misma compra cuando el resumen siguiente trae la
// cuota de adelante. Coincide tarjeta, comercio, monto, moneda y
// cantidad de cuotas. Si el número nuevo es el guardado + 1, es el
// paso normal. Si la serie ya existe y el número es mayor, también
// es la misma compra. Si el guardado ya va más adelante, no se
// retrocede. Un pago sin cuotas también matchea una fecha cercana
// o del mismo mes: eso engancha un alta a mano.
function matchExistingCharge(incoming, pool) {
  const open = pool.filter((item) => !item.taken);
  const repeat = pool.find((item) => item.taken && exactCopy(item, incoming));
  if (repeat) return { kind: "loaded", item: repeat, reason: "Se repite en este resumen." };

  if (incoming.installment_number == null) {
    const hits = open.filter((item) => item.installment_number == null && sameMoney(item, incoming) && datesClose(item.spent_on, incoming.spent_on) && periodMatch(item, incoming));
    if (!hits.length) return null;
    const hit = closest(hits, incoming);
    const period = confirmPeriod(hit, incoming);
    if (period) return period;
    if (!writtenByHand(hit, incoming)) return { kind: "loaded", item: hit, reason: "Mismo pago, misma fecha." };
    return { kind: "link", item: hit, manual: true, reason: HAND_REASON };
  }

  const candidates = open.filter((item) => sameMoney(item, incoming));
  const series = candidates.filter((item) => item.installment_number != null && Number(item.installment_count) === incoming.installment_count);
  const exact = series.find((item) => Number(item.installment_number) === incoming.installment_number);
  if (exact) {
    const period = confirmPeriod(exact, incoming);
    if (period) return period;
    if (exact.description === incoming.description) {
      return { kind: "loaded", item: exact, reason: `La cuota ${incoming.installment_number}/${incoming.installment_count} ya está.` };
    }
    return { kind: "link", item: exact, manual: true, reason: HAND_REASON };
  }
  const earlier = series
    .filter((item) => Number(item.installment_number) < incoming.installment_number)
    .sort((a, b) => Number(b.installment_number) - Number(a.installment_number));
  if (earlier.length) {
    const current = Number(earlier[0].installment_number);
    const step = current + 1 === incoming.installment_number ? "la que sigue" : "la misma compra";
    const manual = earlier[0].description !== incoming.description;
    const base = `Es ${step}: estaba en ${current}/${incoming.installment_count} y pasa a ${incoming.installment_number}/${incoming.installment_count}.`;
    return {
      kind: "update",
      item: earlier[0],
      manual,
      reason: manual ? `${HAND_REASON} ${base}` : base,
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
  const loose = candidates.filter((item) => item.installment_number == null && datesClose(item.spent_on, incoming.spent_on));
  if (loose.length) return { kind: "link", item: closest(loose, incoming), manual: true, reason: HAND_REASON };
  return null;
}

export function reviewSummary(inserts, known, ignored, updates, links = 0) {
  let loaded = `${known} ya cargados`;
  if (updates > 0 && links > 0) loaded = `${known} ya cargados (${updates} cuota, ${links} a mano)`;
  else if (updates > 0) loaded = `${known} ya cargados (se actualiza cuota)`;
  else if (links > 0) loaded = `${known} ya cargados (${links} a mano)`;
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
  let links = 0;
  for (const row of rows) {
    const cleaned = cleanCharge(row, cardId);
    if (!cleaned.ok) return cleaned;
    const selected = row.selected !== false;
    const match = matchExistingCharge(cleaned.row, pool);
    const hadMatch = Boolean(match);
    if (selected && row.force_new && match) {
      const id = `batch-${planned.length}`;
      pool.push({ ...cleaned.row, id, taken: true });
      planned.push({ ...cleaned.row, status: "new", reason: "Lo marcaste como otro consumo.", selected: true, existingId: null, hadMatch: true });
      inserts.push(cleaned.row);
      continue;
    }
    if (match && (String(match.item.id).startsWith("batch-") || match.reason === "Se repite en este resumen.")) {
      planned.push({ ...cleaned.row, status: "loaded", reason: "Se repite en este resumen.", selected: false, existingId: null, hadMatch: true });
      loaded += 1;
      continue;
    }
    if (!selected && (!match || match.kind === "update" || match.kind === "link")) {
      planned.push({ ...cleaned.row, status: "ignored", reason: "Destildado.", selected: false, existingId: match?.item.id ?? null, hadMatch });
      ignored += 1;
      continue;
    }
    if (!match) {
      const id = `batch-${planned.length}`;
      pool.push({ ...cleaned.row, id, taken: true });
      planned.push({ ...cleaned.row, status: "new", reason: "No está cargado.", selected: true, existingId: null, hadMatch: false });
      inserts.push(cleaned.row);
      continue;
    }
    if ((match.kind === "update" || match.kind === "link") && selected) {
      planned.push({
        ...cleaned.row,
        status: match.kind,
        reason: match.reason,
        selected: true,
        existingId: match.item.id,
        hadMatch: true,
      });
      updates.push({ ...cleaned.row, existingId: match.item.id, manual: match.kind === "link" });
      match.item.description = cleaned.row.description;
      match.item.installment_number = cleaned.row.installment_number;
      match.item.installment_count = cleaned.row.installment_count;
      match.item.spent_on = cleaned.row.spent_on;
      match.item.taken = true;
      if (match.kind === "link") links += 1;
      continue;
    }
    match.item.taken = true;
    planned.push({ ...cleaned.row, status: "loaded", reason: match.reason, selected: false, existingId: match.item.id, hadMatch: true });
    loaded += 1;
  }
  const cuotaUpdates = updates.filter((row) => !row.manual).length;
  const known = loaded + updates.length;
  return {
    ok: true,
    rows: planned,
    inserts,
    updates,
    loaded,
    ignored,
    links,
    summary: reviewSummary(inserts.length, known, ignored, cuotaUpdates, links),
  };
}
