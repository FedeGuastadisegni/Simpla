import { forecastMonths, monthSummary, sumByCurrency } from "./card-math.js";
import { listRows, onData, queueChange } from "./db.js";
import { redactLongNumbers } from "./privacy.js";

const DEMO_USER = "00000000-0000-4000-8000-000000000001";

let userId = null;
let selectedCardId = null;
let editingCardId = null;
let editingItemId = null;

export function isLocalDemo() {
  const host = location.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local) return false;
  return new URLSearchParams(location.search).get("demo") === "1";
}

export function setCardUser(id) {
  userId = id;
}

export function focusCard(id) {
  selectedCardId = id;
}

function money(amount, currency) {
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === "USD" ? `USD ${formatted}` : `$ ${formatted}`;
}

function monthLabel(month, style) {
  const date = new Date(month.year, month.month, 1);
  const text = new Intl.DateTimeFormat("es-AR", { month: style }).format(date).replace(".", "");
  return style === "short" ? text.toLocaleUpperCase("es-AR") : text.charAt(0).toLocaleUpperCase("es-AR") + text.slice(1);
}

function todayIso() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function currentMonth() {
  const date = new Date();
  return { year: date.getFullYear(), month: date.getMonth() };
}

function stamp(row) {
  const now = new Date().toISOString();
  return { ...row, updated_at: now, created_at: row.created_at || now };
}

function clear(node) {
  if (node) node.replaceChildren();
}

function field(form, name) {
  return form.elements.namedItem(name);
}

export async function seedExampleIfEmpty() {
  const cards = await listRows("cards");
  if (cards.length > 0) return;
  const cardId = crypto.randomUUID();
  const spentOn = todayIso();
  await queueChange("cards", "insert", stamp({
    id: cardId,
    user_id: DEMO_USER,
    name: "Visa ejemplo",
    due_day: 10,
  }));
  const items = [
    ["Heladera", 100000, "ARS", 12, 12],
    ["Zapatillas", 30000, "ARS", 3, 3],
    ["Cuota en curso", 50000, "ARS", 2, 6],
    ["Consumo en dólares", 20, "USD", null, null],
  ];
  for (const [description, amount, currency, installmentNumber, installmentCount] of items) {
    await queueChange("card_items", "insert", stamp({
      id: crypto.randomUUID(),
      user_id: DEMO_USER,
      card_id: cardId,
      description,
      amount,
      currency,
      spent_on: spentOn,
      installment_number: installmentNumber,
      installment_count: installmentCount,
    }));
  }
}

function itemsFor(items, cardId) {
  return cardId ? items.filter((item) => item.card_id === cardId) : items;
}

function fillInicio(items, cards) {
  const slot = document.getElementById("inicio-tarjeta-slot");
  if (!slot) return;
  const month = currentMonth();
  const summary = monthSummary(items, cards, month);
  const hasItems = items.length > 0;
  clear(slot);
  if (!hasItems) {
    const empty = document.createElement("span");
    empty.className = "tile-empty";
    empty.textContent = "Sin datos";
    slot.append(empty);
    return;
  }
  const figures = document.createElement("span");
  figures.className = "tile-figures";
  const ars = document.createElement("span");
  ars.textContent = money(summary.totals.ARS, "ARS");
  figures.append(ars);
  if (summary.totals.USD > 0) {
    const usd = document.createElement("span");
    usd.className = "tile-usd";
    usd.textContent = money(summary.totals.USD, "USD");
    figures.append(usd);
  }
  slot.append(figures);
}

function line(parent, text, className) {
  const node = document.createElement("p");
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function chargeRow(parent, item, mint) {
  const row = document.createElement("div");
  row.className = mint ? "end-row" : "row";
  const text = document.createElement("div");
  const title = document.createElement("p");
  title.className = "row-title";
  title.textContent = item.description;
  text.append(title);
  if (item.installment_number != null && item.installment_count != null) {
    const meta = document.createElement("p");
    meta.className = "row-meta";
    meta.textContent = `Cuota ${item.installment_number}/${item.installment_count}`;
    text.append(meta);
  }
  const amount = document.createElement("p");
  amount.className = "row-amount";
  amount.textContent = money(Number(item.amount), item.currency === "USD" ? "USD" : "ARS");
  row.append(text, amount);
  parent.append(row);
}

function renderSummary(card, items) {
  const root = document.getElementById("tarjeta-summary");
  const due = document.getElementById("tarjeta-due");
  if (!root || !due) return;
  clear(root);
  if (!card) {
    due.textContent = "Resumen";
    line(root, "Importá un resumen para ver el mes.", "empty");
    return;
  }
  due.textContent = card.closing_day ? `Vence el ${card.due_day} · cierra el ${card.closing_day}` : `Vence el ${card.due_day}`;
  const month = currentMonth();
  const summary = monthSummary(items, [card], month);
  const hero = document.createElement("p");
  hero.className = "display";
  hero.textContent = money(summary.totals.ARS, "ARS");
  root.append(hero);
  const usd = document.createElement("p");
  usd.className = "usd-total";
  usd.textContent = money(summary.totals.USD, "USD");
  root.append(usd);
  if (summary.totals.USD > 0) {
    const warning = document.createElement("p");
    warning.className = "usd-warning";
    warning.textContent = "Si pagás esta parte con pesos, se cobra una percepción del 30% (RG ARCA 5617/2024). Para evitarla, pagala con dólares propios antes del vencimiento. Si tenés débito automático, revisá que la parte en USD salga de tu caja de ahorro en dólares.";
    root.append(warning);
  }

  const drop = sumByCurrency(summary.ending);
  const ink = document.createElement("article");
  ink.className = "ink-card";
  line(ink, "El mes que viene", "ink-kicker");
  if (drop.ARS === 0 && drop.USD === 0) {
    line(ink, "Ninguna cuota termina este mes.", "");
  } else {
    if (drop.ARS > 0) line(ink, `El mes que viene baja ${money(drop.ARS, "ARS")}`, "drop-line");
    if (drop.USD > 0) line(ink, `El mes que viene baja ${money(drop.USD, "USD")}`, "drop-line");
  }
  root.append(ink);

  const endingTitle = document.createElement("h2");
  endingTitle.className = "block-title";
  endingTitle.textContent = "Se termina este mes";
  root.append(endingTitle);
  if (summary.ending.length === 0) {
    line(root, "Ninguna cuota termina este mes.", "empty");
  } else {
    for (const item of summary.ending) chargeRow(root, item, true);
  }

  const cuotas = summary.charges.filter((item) => item.installment_number != null);
  const pagos = summary.charges.filter((item) => item.installment_number == null);
  const cuotasTitle = document.createElement("h2");
  cuotasTitle.className = "block-title";
  cuotasTitle.textContent = "Cuotas";
  root.append(cuotasTitle);
  if (cuotas.length === 0) line(root, "No hay cuotas en este resumen.", "empty");
  for (const item of cuotas) chargeRow(root, item, false);

  const pagosTitle = document.createElement("h2");
  pagosTitle.className = "block-title";
  pagosTitle.textContent = "Consumos del mes";
  root.append(pagosTitle);
  if (pagos.length === 0) line(root, "No hay consumos en un pago.", "empty");
  for (const item of pagos) chargeRow(root, item, false);

  const forecastTitle = document.createElement("h2");
  forecastTitle.className = "block-title";
  forecastTitle.textContent = "Próximos 6 meses";
  root.append(forecastTitle);
  const list = document.createElement("ol");
  list.className = "forecast";
  for (const entry of forecastMonths(items, [card], month, 6)) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.className = "forecast-name";
    name.textContent = monthLabel(entry.month, "short");
    const amounts = document.createElement("span");
    amounts.className = "forecast-amounts";
    amounts.textContent = `${money(entry.totals.ARS, "ARS")} · ${money(entry.totals.USD, "USD")}`;
    row.append(name, amounts);
    list.append(row);
  }
  root.append(list);
}

function renderCardList(cards) {
  const list = document.getElementById("card-list");
  const picker = document.getElementById("card-picker");
  if (!list || !picker) return;
  clear(list);
  clear(picker);
  picker.hidden = cards.length < 2;
  for (const card of cards) {
    const item = document.createElement("li");
    item.className = "manage-row";
    const name = document.createElement("span");
    const closing = card.closing_day ? ` · cierra el ${card.closing_day}` : "";
    name.textContent = `${card.name} · vence el ${card.due_day}${closing}`;
    const actions = document.createElement("span");
    actions.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => startCardEdit(card));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Borrar";
    remove.addEventListener("click", () => deleteCard(card));
    actions.append(edit, remove);
    item.append(name, actions);
    list.append(item);

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = card.id === selectedCardId ? "chip is-on" : "chip";
    pick.textContent = card.name;
    pick.addEventListener("click", () => {
      selectedCardId = card.id;
      renderTarjeta();
    });
    picker.append(pick);
  }
}

function renderItemList(items, cards) {
  const list = document.getElementById("item-list");
  const select = document.getElementById("item-card");
  if (!list || !select) return;
  const names = new Map(cards.map((card) => [card.id, card.name]));
  clear(list);
  const previous = select.value;
  clear(select);
  for (const card of cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.name;
    select.append(option);
  }
  if (cards.some((card) => card.id === previous)) select.value = previous;
  else if (selectedCardId) select.value = selectedCardId;

  const sorted = [...items].sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on)));
  for (const item of sorted) {
    const row = document.createElement("li");
    row.className = "manage-row";
    const text = document.createElement("span");
    const quota = item.installment_number != null ? ` · cuota ${item.installment_number}/${item.installment_count}` : "";
    text.textContent = `${item.description} · ${money(Number(item.amount), item.currency)}${quota}`;
    const meta = document.createElement("span");
    meta.className = "row-meta";
    meta.textContent = names.get(item.card_id) || "";
    const actions = document.createElement("span");
    actions.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => startItemEdit(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Borrar";
    remove.addEventListener("click", () => deleteItem(item));
    actions.append(edit, remove);
    row.append(text, meta, actions);
    list.append(row);
  }
}

function startCardEdit(card) {
  const form = document.getElementById("card-form");
  editingCardId = card.id;
  field(form, "name").value = card.name;
  field(form, "due_day").value = card.due_day;
  field(form, "closing_day").value = card.closing_day ?? "";
  document.getElementById("card-submit").textContent = "Guardar cambios";
  form.querySelector("[name=name]").focus();
}

function resetCardForm() {
  const form = document.getElementById("card-form");
  editingCardId = null;
  form.reset();
  document.getElementById("card-submit").textContent = "Agregar tarjeta";
  document.getElementById("card-form-error").textContent = "";
}

function startItemEdit(item) {
  const form = document.getElementById("item-form");
  editingItemId = item.id;
  field(form, "card_id").value = item.card_id;
  field(form, "description").value = item.description;
  field(form, "amount").value = item.amount;
  field(form, "currency").value = item.currency;
  field(form, "spent_on").value = String(item.spent_on).slice(0, 10);
  field(form, "installment_number").value = item.installment_number ?? "";
  field(form, "installment_count").value = item.installment_count ?? "";
  document.getElementById("item-submit").textContent = "Guardar cambios";
  form.querySelector("[name=description]").focus();
}

function resetItemForm() {
  const form = document.getElementById("item-form");
  editingItemId = null;
  form.reset();
  field(form, "spent_on").value = todayIso();
  field(form, "currency").value = "ARS";
  if (selectedCardId) field(form, "card_id").value = selectedCardId;
  document.getElementById("item-submit").textContent = "Agregar consumo";
  document.getElementById("item-form-error").textContent = "";
}

async function deleteCard(card) {
  if (!confirm(`¿Borrar ${card.name} y sus consumos?`)) return;
  const items = await listRows("card_items");
  for (const item of items.filter((row) => row.card_id === card.id)) {
    await queueChange("card_items", "delete", { id: item.id });
  }
  await queueChange("cards", "delete", { id: card.id });
  if (selectedCardId === card.id) selectedCardId = null;
  if (editingCardId === card.id) resetCardForm();
}

async function deleteItem(item) {
  if (!confirm("¿Borrar este consumo?")) return;
  await queueChange("card_items", "delete", { id: item.id });
  if (editingItemId === item.id) resetItemForm();
}

function wireForms() {
  const cardForm = document.getElementById("card-form");
  const itemForm = document.getElementById("item-form");
  if (!cardForm || cardForm.dataset.wired === "1") return;
  cardForm.dataset.wired = "1";
  itemForm.dataset.wired = "1";
  field(itemForm, "spent_on").value = todayIso();

  cardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("card-form-error");
    error.textContent = "";
    if (!userId) return;
    const name = redactLongNumbers(field(cardForm, "name").value.trim());
    const due = Number(field(cardForm, "due_day").value);
    const closingRaw = field(cardForm, "closing_day").value.trim();
    const closing = closingRaw === "" ? null : Number(closingRaw);
    if (!name) {
      error.textContent = "Poné un nombre.";
      return;
    }
    if (!Number.isInteger(due) || due < 1 || due > 31) {
      error.textContent = "El vencimiento es un día del 1 al 31.";
      return;
    }
    if (closing != null && (!Number.isInteger(closing) || closing < 1 || closing > 31)) {
      error.textContent = "El cierre es un día del 1 al 31.";
      return;
    }
    const id = editingCardId || crypto.randomUUID();
    const existing = editingCardId
      ? (await listRows("cards")).find((card) => card.id === editingCardId)
      : null;
    await queueChange("cards", editingCardId ? "update" : "insert", stamp({
      id,
      user_id: userId,
      name,
      due_day: due,
      closing_day: closing,
      created_at: existing?.created_at,
    }));
    selectedCardId = id;
    resetCardForm();
  });

  itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("item-form-error");
    error.textContent = "";
    if (!userId) return;
    const cards = await listRows("cards");
    if (cards.length === 0) {
      error.textContent = "Importá un resumen o agregá una tarjeta a mano.";
      return;
    }
    const description = redactLongNumbers(field(itemForm, "description").value.trim());
    const amount = Number(String(field(itemForm, "amount").value).replace(",", "."));
    const currency = field(itemForm, "currency").value;
    const spentOn = field(itemForm, "spent_on").value;
    const cardId = field(itemForm, "card_id").value;
    const rawCurrent = field(itemForm, "installment_number").value.trim();
    const rawTotal = field(itemForm, "installment_count").value.trim();
    if (!description) {
      error.textContent = "Poné una descripción.";
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      error.textContent = "El monto no es válido.";
      return;
    }
    if (currency !== "ARS" && currency !== "USD") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
      error.textContent = "Elegí una fecha.";
      return;
    }
    let installmentNumber = null;
    let installmentCount = null;
    if (rawCurrent !== "" || rawTotal !== "") {
      installmentNumber = Number(rawCurrent);
      installmentCount = Number(rawTotal);
      if (!Number.isInteger(installmentNumber) || !Number.isInteger(installmentCount) || installmentCount < 1 || installmentNumber < 1 || installmentNumber > installmentCount) {
        error.textContent = "Completá la cuota actual y el total, o dejá los dos vacíos.";
        return;
      }
    }
    const id = editingItemId || crypto.randomUUID();
    const existing = editingItemId
      ? (await listRows("card_items")).find((item) => item.id === editingItemId)
      : null;
    await queueChange("card_items", editingItemId ? "update" : "insert", stamp({
      id,
      user_id: userId,
      card_id: cardId,
      description,
      amount,
      currency,
      spent_on: spentOn,
      installment_number: installmentNumber,
      installment_count: installmentCount,
      created_at: existing?.created_at,
    }));
    selectedCardId = cardId;
    resetItemForm();
  });
}

export async function renderTarjeta() {
  wireForms();
  const cards = await listRows("cards");
  const items = await listRows("card_items");
  if (!cards.some((card) => card.id === selectedCardId)) {
    selectedCardId = cards[0]?.id || null;
  }
  const card = cards.find((row) => row.id === selectedCardId) || null;
  const scoped = itemsFor(items, selectedCardId);
  fillInicio(items, cards);
  renderSummary(card, scoped);
  renderCardList(cards);
  renderItemList(items, cards);
  const flag = document.getElementById("demo-flag");
  if (flag) flag.hidden = !isLocalDemo();
}

export function watchCardData() {
  onData(() => {
    renderTarjeta();
  });
}

export { DEMO_USER };
