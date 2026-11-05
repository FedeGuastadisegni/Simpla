import { matchCard, parseBbvaStatement, planStatementImport } from "./bbva.js";
import { redactLongNumbers } from "./privacy.js";
import { listRows, queueChange } from "./db.js";
import { textFromPdf } from "./pdf-text.js";
import { focusCard } from "./tarjeta.js";

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
  return currency === "USD" ? `USD ${formatted}` : `$ ${formatted}`;
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
  if (status === "loaded") return "Ya está";
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
  });
  const totals = totalsOf(readRows().filter((row, index) => plan.rows[index]?.status === "new"));
  summary.textContent = `${plan.summary}. En los nuevos: ${money(totals.usd, "USD")} / ${money(totals.ars, "ARS")}.`;
}

function readRows() {
  return [...document.querySelectorAll(".pdf-line")].map((node) => {
    const current = node.querySelector("[data-field=installment_number]").value.trim();
    const total = node.querySelector("[data-field=installment_count]").value.trim();
    return {
      selected: node.querySelector("[data-field=selected]").checked,
      description: node.querySelector("[data-field=description]").value,
      amount: Number(String(node.querySelector("[data-field=amount]").value).replace(",", ".")),
      currency: node.querySelector("[data-field=currency]").value,
      spent_on: node.querySelector("[data-field=spent_on]").value,
      installment_number: current === "" ? null : Number(current),
      installment_count: total === "" ? null : Number(total),
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
    const description = add(line, "input");
    description.dataset.field = "description";
    description.value = charge.description;
    description.maxLength = 120;
    const amount = add(line, "input");
    amount.dataset.field = "amount";
    amount.type = "number";
    amount.min = "0";
    amount.step = "0.01";
    amount.value = String(charge.amount);
    const currency = add(line, "select");
    currency.dataset.field = "currency";
    for (const code of ["ARS", "USD"]) {
      const option = add(currency, "option", "", code);
      option.value = code;
    }
    currency.value = charge.currency;
    const date = add(line, "input");
    date.dataset.field = "spent_on";
    date.type = "date";
    date.value = charge.spent_on;
    const quotas = add(line, "div", "pdf-quotas");
    const current = add(quotas, "input");
    current.dataset.field = "installment_number";
    current.type = "number";
    current.min = "1";
    current.placeholder = "Cuota";
    current.value = charge.installment_number ?? "";
    const count = add(quotas, "input");
    count.dataset.field = "installment_count";
    count.type = "number";
    count.min = "1";
    count.placeholder = "De";
    count.value = charge.installment_count ?? "";
    add(line, "p", "pdf-status is-new", "Nuevo");
    add(line, "p", "pdf-reason", "");
    line.addEventListener("input", paintSummary);
  }
}

async function paintCardChoice() {
  const cards = await listRows("cards");
  const matched = matchCard(cards, review.productName);
  const name = document.getElementById("pdf-card-name");
  const note = document.getElementById("pdf-card-note");
  name.value = matched ? matched.name : review.productName;
  note.textContent = matched
    ? "Ya hay una tarjeta parecida. Los consumos van ahí, con el cierre y el vencimiento de este resumen."
    : "Al confirmar se crea la tarjeta, con el cierre y el vencimiento de este resumen.";
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
  document.getElementById("pdf-card-note").textContent = "";
  clear(document.getElementById("pdf-lines"));
}

function stamp(row) {
  const now = new Date().toISOString();
  return { ...row, updated_at: now, created_at: row.created_at || now };
}

async function openFile(file) {
  const error = document.getElementById("pdf-error");
  error.textContent = "";
  let bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  try {
    text = await textFromPdf(bytes);
    review = parseBbvaStatement(text);
  } catch (failure) {
    review = null;
    document.getElementById("pdf-review").hidden = false;
    error.textContent = "No pude leer ese PDF.";
    return;
  } finally {
    text = "";
    try {
      bytes.fill(0);
    } catch (ignored) {
      /* el buffer puede haber quedado desprendido */
    }
    bytes = null;
  }
  if (!review.charges.length) {
    review = null;
    clear(document.getElementById("pdf-lines"));
    document.getElementById("pdf-summary").textContent = "";
    document.getElementById("pdf-dates").textContent = "";
    document.getElementById("pdf-balances").textContent = "";
    error.textContent = "No encontré consumos en ese resumen.";
    document.getElementById("pdf-review").hidden = false;
    return;
  }
  const panel = document.getElementById("pdf-review");
  panel.hidden = false;
  const dates = [`Cierre ${shortDate(review.closingDate)}`, `Vencimiento ${shortDate(review.dueDate)}`];
  if (review.nextClosing || review.nextDue) {
    dates.push(`Próximo cierre ${shortDate(review.nextClosing)}, próximo vencimiento ${shortDate(review.nextDue)}. Eso no se guarda.`);
  }
  document.getElementById("pdf-dates").textContent = dates.join(" · ");
  document.getElementById("pdf-balances").textContent = `Saldo del resumen ${money(review.balanceARS, "ARS")} y ${money(review.balanceUSD, "USD")}. No se guarda.`;
  knownCards = await listRows("cards");
  knownItems = await listRows("card_items");
  paintLines(review.charges);
  await paintCardChoice();
  paintSummary();
  panel.scrollIntoView({ block: "start" });
}

async function confirmReview() {
  const error = document.getElementById("pdf-error");
  const notice = document.getElementById("pdf-notice");
  error.textContent = "";
  notice.textContent = "";
  if (!review || !userId) return;
  const name = redactLongNumbers(document.getElementById("pdf-card-name").value.trim());
  if (!name) {
    error.textContent = "Poné un nombre para la tarjeta.";
    return;
  }
  knownCards = await listRows("cards");
  knownItems = await listRows("card_items");
  const matched = matchCard(knownCards, name);
  const due = review.dueDay || matched?.due_day || 1;
  const closing = review.closingDay ?? matched?.closing_day ?? null;
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
    }));
  } else {
    await queueChange("cards", "update", stamp({
      ...matched,
      user_id: userId,
      name,
      due_day: due,
      closing_day: closing,
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
    }));
  }
  focusCard(cardId);
  const parts = [];
  if (plan.inserts.length) parts.push(`Guardé ${plan.inserts.length} consumos`);
  if (plan.updates.length) parts.push(`actualicé ${plan.updates.length} cuotas`);
  if (plan.loaded) parts.push(`${plan.loaded} ya estaban`);
  notice.textContent = parts.length ? `${parts.join(", ")}.` : "No había consumos para guardar.";
  review = null;
  clear(document.getElementById("pdf-lines"));
  document.getElementById("pdf-summary").textContent = notice.textContent;
}

function takePdf(file) {
  if (!file) return;
  const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!pdf) {
    document.getElementById("pdf-review").hidden = false;
    document.getElementById("pdf-error").textContent = "Ese archivo no es un PDF.";
    return;
  }
  openFile(file);
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
    takePdf(file);
  });
  document.getElementById("pdf-card-name").addEventListener("input", paintSummary);
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    takePdf(event.dataTransfer?.files?.[0]);
  });
  document.getElementById("pdf-cancel").addEventListener("click", closeReview);
  document.getElementById("pdf-confirm").addEventListener("click", () => {
    confirmReview();
  });
}

wire();
