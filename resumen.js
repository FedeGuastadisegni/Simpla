import { matchCard, normalizeOcrText, parseCardStatement, planStatementImport } from "./statement-parser.js";
import { amountNode } from "./money-view.js";
import { redactLongNumbers } from "./privacy.js";
import { listRows, queueChange } from "./db.js";
import { textFromPdf } from "./pdf-text.js";
import { focusCard } from "./tarjeta.js";
import { parseIsoDate } from "./card-math.js";

let userId = null;
let review = null;
let knownCards = [];
let knownItems = [];

export function setStatementUser(id) {
  userId = id;
}

function money(amount, currency) {
  if (amount == null) return "—";
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === "USD" ? `USD ${formatted}` : `$${formatted}`;
}

function shortDate(iso) {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function add(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.append(node);
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function labeledInput(parent, text, type) {
  const label = add(parent, "label");
  add(label, "span", "", text);
  const input = add(label, "input");
  if (type) input.type = type;
  return input;
}

function totalsOf(rows) {
  const selected = rows.filter((row) => row.selected !== false);
  let ars = 0;
  let usd = 0;
  let quotas = 0;
  for (const row of selected) {
    if (row.currency === "USD") usd += Number(row.amount) || 0;
    else ars += Number(row.amount) || 0;
    if (row.installment_number != null) quotas += 1;
  }
  return { count: selected.length, quotas, ars, usd };
}

function statusLabel(status) {
  if (status === "update") return "Actualiza cuota";
  if (status === "link") return "Ya cargado (manual)";
  if (status === "loaded") return "Ya cargado";
  if (status === "ignored") return "Ignorado";
  return "Nuevo";
}

function paintSummary() {
  const name = document.getElementById("pdf-card-name").value.trim();
  const cardId = matchCard(knownCards, name)?.id || "nueva";
  const plan = planStatementImport(readRows(), cardId, knownItems);
  const summary = document.getElementById("pdf-summary");
  if (!plan.ok) {
    document.getElementById("pdf-error").textContent = plan.error;
    return;
  }
  document.getElementById("pdf-error").textContent = "";
  const lines = [...document.querySelectorAll(".pdf-line")];
  plan.rows.forEach((row, index) => {
    const node = lines[index];
    if (!node) return;
    const badge = node.querySelector(".pdf-status");
    badge.textContent = statusLabel(row.status);
    badge.className = `pdf-status is-${row.status}`;
    node.querySelector(".pdf-reason").textContent = row.reason;
    const box = node.querySelector("[data-field=selected]");
    if (row.status === "loaded" || row.status === "ignored") box.checked = false;
    const other = node.querySelector("[data-field=force_new]");
    if (other) other.closest("label").hidden = !(row.hadMatch || other.checked);
  });
  const totals = totalsOf(readRows().filter((row, index) => plan.rows[index]?.status === "new"));
  summary.replaceChildren(`${plan.summary}. `);
  if (totals.usd > 0) {
    summary.append("Dólares nuevos: ", amountNode(totals.usd, "USD"), ". El peso de al lado es el MEP; si tocás el dólar ves el valor tarjeta. ");
  }
  if (totals.ars > 0) summary.append(`Consumos en pesos: ${money(totals.ars, "ARS")}.`);
}

function readRows() {
  return [...document.querySelectorAll(".pdf-line")].map((node) => {
    const current = node.querySelector("[data-field=installment_number]").value.trim();
    const total = node.querySelector("[data-field=installment_count]").value.trim();
    return {
      selected: node.querySelector("[data-field=selected]").checked,
      force_new: node.querySelector("[data-field=force_new]")?.checked === true,
      description: node.querySelector("[data-field=description]").value,
      amount: Number(String(node.querySelector("[data-field=amount]").value).replace(",", ".")),
      currency: node.querySelector("[data-field=currency]").value,
      spent_on: node.querySelector("[data-field=spent_on]").value,
      installment_number: current === "" ? null : Number(current),
      installment_count: total === "" ? null : Number(total),
      statement_closes_on: document.getElementById("pdf-closing-on").value,
      statement_due_on: document.getElementById("pdf-due-on").value,
    };
  });
}

function paintLines(charges) {
  const root = document.getElementById("pdf-lines");
  clear(root);
  for (const charge of charges) {
    const line = add(root, "div", "pdf-line");
    const top = add(line, "label", "check");
    const box = add(top, "input");
    box.type = "checkbox";
    box.dataset.field = "selected";
    box.checked = charge.selected !== false;
    top.append(` ${shortDate(charge.spent_on)}`);
    const description = labeledInput(line, "Descripción");
    description.dataset.field = "description";
    description.value = charge.description;
    description.maxLength = 120;
    const amount = labeledInput(line, "Monto", "number");
    amount.dataset.field = "amount";
    amount.min = "0";
    amount.step = "0.01";
    amount.value = String(charge.amount);
    const currencyLabel = add(line, "label");
    add(currencyLabel, "span", "", "Moneda");
    const currency = add(currencyLabel, "select");
    currency.dataset.field = "currency";
    for (const code of ["ARS", "USD"]) {
      const option = add(currency, "option", "", code);
      option.value = code;
    }
    currency.value = charge.currency;
    const date = labeledInput(line, "Fecha", "date");
    date.dataset.field = "spent_on";
    date.value = charge.spent_on;
    const quotas = add(line, "div", "pdf-quotas");
    const current = labeledInput(quotas, "Cuota actual", "number");
    current.dataset.field = "installment_number";
    current.min = "1";
    current.placeholder = "Vacío si es un pago";
    current.value = charge.installment_number ?? "";
    const count = labeledInput(quotas, "Cuotas totales", "number");
    count.dataset.field = "installment_count";
    count.min = "1";
    count.placeholder = "Vacío si es un pago";
    count.value = charge.installment_count ?? "";
    add(line, "p", "pdf-status is-new", "Nuevo");
    add(line, "p", "pdf-reason", "");
    const other = add(line, "label", "check");
    const force = add(other, "input");
    force.type = "checkbox";
    force.dataset.field = "force_new";
    other.append(" Es otro consumo");
    other.hidden = true;
    line.addEventListener("input", paintSummary);
  }
}

async function paintCardChoice() {
  const cards = await listRows("cards");
  const matched = matchCard(cards, review.productName);
  const name = document.getElementById("pdf-card-name");
  const note = document.getElementById("pdf-card-note");
  name.value = matched ? matched.name : review.productName;
  const base = matched
    ? "Ya hay una tarjeta parecida. Los consumos van ahí."
    : "Al confirmar se crea la tarjeta.";
  note.textContent = `${base}${dateMismatch(matched)}`;
}

function dateMismatch(matched) {
  if (!matched || !review) return " Se guardan el cierre y el vencimiento de este resumen.";
  if (matched.last_closing_on && review.closingDate && review.closingDate < matched.last_closing_on) {
    return " Es un resumen anterior. Los consumos conservan su período y la tarjeta mantiene las fechas del resumen más reciente.";
  }
  const dueDiffers = review.dueDay != null && Number(matched.due_day) !== Number(review.dueDay);
  const closeDiffers = review.closingDay != null && Number(matched.closing_day) !== Number(review.closingDay);
  if (!dueDiffers && !closeDiffers) return " El cierre y el vencimiento coinciden con la tarjeta guardada.";
  const savedClose = matched.closing_day == null ? "sin día de cierre" : `cierra el ${matched.closing_day}`;
  const pdfClose = review.closingDay == null ? "sin día de cierre" : `cierra el ${review.closingDay}`;
  return ` El PDF vence el ${review.dueDay ?? "—"} y ${pdfClose}. La tarjeta guardada vence el ${matched.due_day} y ${savedClose}. Al confirmar quedan los del PDF.`;
}

function closeReview() {
  review = null;
  const panel = document.getElementById("pdf-review");
  panel.hidden = true;
  document.getElementById("pdf-error").textContent = "";
  document.getElementById("pdf-notice").textContent = "";
  document.getElementById("pdf-summary").textContent = "";
  document.getElementById("pdf-dates").textContent = "";
  document.getElementById("pdf-balances").textContent = "";
  document.getElementById("pdf-card-name").value = "";
  document.getElementById("pdf-closing-on").value = "";
  document.getElementById("pdf-due-on").value = "";
  document.getElementById("pdf-card-note").textContent = "";
  clear(document.getElementById("pdf-lines"));
}

function stamp(row) {
  const now = new Date().toISOString();
  return { ...row, updated_at: now, created_at: row.created_at || now };
}

const OCR_FAIL = "No pude leer bien la captura; cargá a mano o probá el PDF";

async function showReview(parsed, emptyMessage) {
  const error = document.getElementById("pdf-error");
  if (!parsed?.charges?.length) {
    review = null;
    clear(document.getElementById("pdf-lines"));
    document.getElementById("pdf-summary").textContent = "";
    document.getElementById("pdf-dates").textContent = "";
    document.getElementById("pdf-balances").textContent = "";
    error.textContent = emptyMessage;
    document.getElementById("pdf-review").hidden = false;
    return;
  }
  review = parsed;
  document.getElementById("pdf-closing-on").value = parsed.closingDate || "";
  document.getElementById("pdf-due-on").value = parsed.dueDate || "";
  error.textContent = "";
  const panel = document.getElementById("pdf-review");
  panel.hidden = false;
  const dates = [`Cierre ${shortDate(review.closingDate)}`, `Vencimiento ${shortDate(review.dueDate)}`];
  if (review.nextClosing || review.nextDue) {
    dates.push(`Próximo cierre ${shortDate(review.nextClosing)}, próximo vencimiento ${shortDate(review.nextDue)}. Se usan para estimar las compras posteriores al cierre.`);
  }
  document.getElementById("pdf-dates").textContent = dates.join(" · ");
  const balances = document.getElementById("pdf-balances");
  balances.replaceChildren(`Saldo del resumen ${money(review.balanceARS, "ARS")} y `, amountNode(review.balanceUSD, "USD"), ". No se guarda.");
  knownCards = await listRows("cards");
  knownItems = await listRows("card_items");
  paintLines(review.charges);
  await paintCardChoice();
  paintSummary();
  panel.scrollIntoView({ block: "start" });
}

async function openFile(file) {
  const error = document.getElementById("pdf-error");
  error.textContent = "";
  let bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  try {
    text = await textFromPdf(bytes);
    await showReview(parseCardStatement(text), "No encontré consumos en ese resumen.");
  } catch (failure) {
    review = null;
    document.getElementById("pdf-review").hidden = false;
    error.textContent = "No pude leer ese PDF.";
  } finally {
    text = "";
    try {
      bytes.fill(0);
    } catch (ignored) {
      /* el buffer puede haber quedado desprendido */
    }
    bytes = null;
  }
}

async function openImage(file) {
  const error = document.getElementById("pdf-error");
  const notice = document.getElementById("pdf-notice");
  error.textContent = "";
  notice.textContent = "Leyendo la captura en este teléfono. No se guarda.";
  document.getElementById("pdf-review").hidden = false;
  clear(document.getElementById("pdf-lines"));
  let text = "";
  try {
    const { textFromImage } = await import("./ocr.js");
    text = normalizeOcrText(await textFromImage(file));
    const parsed = parseCardStatement(text);
    text = "";
    notice.textContent = "";
    await showReview(parsed, OCR_FAIL);
  } catch (failure) {
    text = "";
    review = null;
    notice.textContent = "";
    clear(document.getElementById("pdf-lines"));
    error.textContent = OCR_FAIL;
  }
}

async function confirmReview() {
  const error = document.getElementById("pdf-error");
  const notice = document.getElementById("pdf-notice");
  error.textContent = "";
  notice.textContent = "";
  if (!review || !userId) return;
  if (!document.getElementById("pdf-closing-on").value || !document.getElementById("pdf-due-on").value) {
    error.textContent = "Completá el cierre y el vencimiento para ubicar los consumos en el mes de pago.";
    return;
  }
  const name = redactLongNumbers(document.getElementById("pdf-card-name").value.trim());
  if (!name) {
    error.textContent = "Poné un nombre para la tarjeta.";
    return;
  }
  knownCards = await listRows("cards");
  knownItems = await listRows("card_items");
  const matched = matchCard(knownCards, name);
  const closingOn = document.getElementById("pdf-closing-on").value;
  const dueOn = document.getElementById("pdf-due-on").value;
  if (!parseIsoDate(closingOn) || !parseIsoDate(dueOn) || dueOn < closingOn) {
    error.textContent = "Revisá las fechas: el vencimiento debe ser igual o posterior al cierre.";
    return;
  }
  const due = Number(dueOn.slice(-2));
  const closing = Number(closingOn.slice(-2));
  const period = {
    last_closing_on: closingOn,
    last_due_on: dueOn,
    next_closing_on: review.nextClosing > closingOn && review.nextDue > dueOn ? review.nextClosing : null,
    next_due_on: review.nextClosing > closingOn && review.nextDue > dueOn ? review.nextDue : null,
  };
  const updateCard = !matched?.last_closing_on || closingOn >= matched.last_closing_on;
  const cardId = matched?.id || crypto.randomUUID();
  const plan = planStatementImport(readRows(), cardId, await listRows("card_items"));
  if (!plan.ok) {
    error.textContent = plan.error;
    return;
  }
  if (!matched) {
    await queueChange("cards", "insert", stamp({
      id: cardId,
      user_id: userId,
      name,
      due_day: due,
      closing_day: closing,
      ...period,
    }));
  } else {
    await queueChange("cards", "update", stamp({
      ...matched,
      user_id: userId,
      name,
      ...(updateCard ? { due_day: due, closing_day: closing, ...period } : {}),
    }));
  }
  for (const row of plan.inserts) {
    await queueChange("card_items", "insert", stamp({
      id: crypto.randomUUID(),
      user_id: userId,
      ...row,
    }));
  }
  for (const row of plan.updates) {
    const existing = knownItems.find((item) => item.id === row.existingId);
    if (!existing) continue;
    await queueChange("card_items", "update", stamp({
      ...existing,
      user_id: userId,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      spent_on: row.spent_on,
      installment_number: row.installment_number,
      installment_count: row.installment_count,
      statement_closes_on: row.statement_closes_on,
      statement_due_on: row.statement_due_on,
    }));
  }
  focusCard(cardId);
  const parts = [];
  if (plan.inserts.length) parts.push(`Guardé ${plan.inserts.length} consumos`);
  if (plan.links) parts.push(`vinculé ${plan.links} con lo que habías cargado a mano`);
  const cuotaUpdates = plan.updates.length - (plan.links || 0);
  if (cuotaUpdates > 0) parts.push(`actualicé ${cuotaUpdates} cuotas`);
  if (plan.loaded) parts.push(`${plan.loaded} ya estaban`);
  notice.textContent = parts.length ? `${parts.join(", ")}.` : "No había consumos para guardar.";
  review = null;
  clear(document.getElementById("pdf-lines"));
  document.getElementById("pdf-dates").textContent = "";
  document.getElementById("pdf-balances").textContent = "";
  document.getElementById("pdf-summary").textContent = notice.textContent;
}

function isPdf(file) {
  const name = file.name.toLowerCase();
  return file.type === "application/pdf" || name.endsWith(".pdf");
}

function isImage(file) {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return type === "image/jpeg" || type === "image/png" || type === "image/webp"
    || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp");
}

function takeStatement(file) {
  if (!file) return;
  if (isPdf(file)) {
    openFile(file);
    return;
  }
  if (isImage(file)) {
    openImage(file);
    return;
  }
  document.getElementById("pdf-review").hidden = false;
  document.getElementById("pdf-error").textContent = "Ese archivo no es un PDF ni una captura.";
}

function wire() {
  const button = document.getElementById("import-pdf");
  const input = document.getElementById("import-pdf-file");
  const drop = document.getElementById("pdf-drop");
  if (!button || button.dataset.wired === "1") return;
  button.dataset.wired = "1";
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    takeStatement(file);
  });
  document.getElementById("pdf-card-name").addEventListener("input", paintSummary);
  for (const id of ["pdf-closing-on", "pdf-due-on"]) {
    document.getElementById(id).addEventListener("input", paintSummary);
  }
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    takeStatement(event.dataTransfer?.files?.[0]);
  });
  document.getElementById("pdf-cancel").addEventListener("click", closeReview);
  document.getElementById("pdf-confirm").addEventListener("click", () => {
    confirmReview();
  });
}

wire();
