import { listRows, onData, queueChange } from "./db.js";
import { amountNode, putAmount } from "./money-view.js";
import { redactLongNumbers } from "./privacy.js";
import { CATEGORIES } from "./service-categories.js";
export { CATEGORIES } from "./service-categories.js";
import {
  BANK_GAP_NOTE,
  bankDifference,
  fromMonthKey,
  germanSchedule,
  loanHits,
  loansInMonth,
  monthKey,
  roundMoney,
  duplicateBill,
  serviceAmountInMonth,
  serviceEstimate,
  paidOnCard,
  subscriptionsInMonth,
} from "./projections.js";

const USD_WARNING = "Si pagás esta parte con pesos, se cobra una percepción del 30% (RG ARCA 5617/2024). Para evitarla, pagala con dólares propios antes del vencimiento. Si tenés débito automático, revisá que la parte en USD salga de tu caja de ahorro en dólares.";

const LEGACY_CATEGORIES = {
  celular: "Línea de celular",
  otro: "Otro",
};

let userId = null;
let editingLoanId = null;
let editingSubId = null;
let editingServiceId = null;
let editingBillId = null;
let wired = false;

export function setPlanUser(id) {
  userId = id;
}

function money(amount, currency) {
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === "USD" ? `USD ${formatted}` : `$${formatted}`;
}

function currentMonth() {
  const date = new Date();
  return { year: date.getFullYear(), month: date.getMonth() };
}

function monthName(month, style = "long") {
  const date = new Date(month.year, month.month, 1);
  const text = new Intl.DateTimeFormat("es-AR", { month: style }).format(date).replace(".", "");
  if (style === "short") return text.charAt(0).toLocaleUpperCase("es-AR") + text.slice(1);
  return text;
}

function monthYear(iso) {
  const match = /^(\d{4})-(\d{2})/.exec(String(iso ?? ""));
  if (!match) return "";
  return `${monthName({ year: Number(match[1]), month: Number(match[2]) - 1 })} ${match[1]}`;
}

function periodOf(month) {
  return `${month.year}-${String(month.month + 1).padStart(2, "0")}`;
}

function shiftMonth(month, offset) {
  return fromMonthKey(monthKey(month.year, month.month) + offset);
}

function todayIso() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

function add(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.append(node);
  return node;
}

function figures(parent, totals, currencyMode) {
  const box = add(parent, "span", "tile-figures");
  if (currencyMode === "ars") {
    add(box, "span", "", money(totals, "ARS"));
    return;
  }
  const pesos = Number(totals.ARS) || 0;
  const dolares = Number(totals.USD) || 0;
  if (pesos > 0 || dolares === 0) add(box, "span", "", money(pesos, "ARS"));
  if (dolares > 0) {
    const usd = add(box, "span", "tile-usd");
    putAmount(usd, dolares, "USD");
  }
}

function forecastList(parent, months, mode) {
  const list = add(parent, "ol", "forecast");
  for (const entry of months) {
    const row = add(list, "li");
    add(row, "span", "forecast-name", monthName(entry.month, "short"));
    const amounts = add(row, "span", "forecast-amounts");
    if (mode === "ars") amounts.textContent = money(entry.amount, "ARS");
    else {
      const pesos = Number(entry.totals.ARS) || 0;
      const dolares = Number(entry.totals.USD) || 0;
      if (pesos > 0 || dolares === 0) amounts.append(money(pesos, "ARS"));
      if (dolares > 0) {
        if (pesos > 0) amounts.append(" · ");
        amounts.append(amountNode(dolares, "USD"));
      }
    }
  }
}

function nextMonths(count = 6) {
  const start = currentMonth();
  return Array.from({ length: count }, (_, offset) => shiftMonth(start, offset));
}

function fillSlot(id, hasData, totals, mode) {
  const slot = document.getElementById(id);
  if (!slot) return;
  clear(slot);
  if (!hasData) {
    add(slot, "span", "tile-empty", "Sin datos");
    return;
  }
  figures(slot, totals, mode);
}

export function categoryLabel(code) {
  return CATEGORIES.find(([value]) => value === code)?.[1] || LEGACY_CATEGORIES[code] || code;
}

export async function seedPlansIfEmpty() {
  const [loans, subscriptions, services] = await Promise.all([
    listRows("loans"),
    listRows("subscriptions"),
    listRows("services"),
  ]);
  if (loans.length > 0 || subscriptions.length > 0 || services.length > 0) return;
  const now = currentMonth();
  const end = shiftMonth(now, 7);
  const endGerman = shiftMonth(now, 11);
  await queueChange("loans", "insert", stamp({
    id: crypto.randomUUID(),
    user_id: userId,
    name: "Préstamo personal",
    installment_amount: 95000,
    remaining_installments: 8,
    ends_on: `${end.year}-${String(end.month + 1).padStart(2, "0")}-01`,
    amortization: "fija",
    adjust_bank: false,
  }));
  await queueChange("loans", "insert", stamp({
    id: crypto.randomUUID(),
    user_id: userId,
    name: "Préstamo alemán",
    installment_amount: 160000,
    remaining_installments: 12,
    ends_on: `${endGerman.year}-${String(endGerman.month + 1).padStart(2, "0")}-01`,
    amortization: "aleman",
    remaining_principal: 1200000,
    tem: 5,
    cft: 79.5,
    current_installment_bank: 168000,
    adjust_bank: false,
  }));
  const charge = todayIso();
  await queueChange("subscriptions", "insert", stamp({
    id: crypto.randomUUID(),
    user_id: userId,
    name: "Netflix",
    amount: 11999,
    currency: "ARS",
    frequency: "mensual",
    next_charge_on: charge,
    on_card: true,
  }));
  await queueChange("subscriptions", "insert", stamp({
    id: crypto.randomUUID(),
    user_id: userId,
    name: "iCloud",
    amount: 20,
    currency: "USD",
    frequency: "anual",
    next_charge_on: charge,
  }));
  const luz = crypto.randomUUID();
  const internet = crypto.randomUUID();
  await queueChange("services", "insert", stamp({
    id: luz,
    user_id: userId,
    name: "Edenor",
    category: "luz",
  }));
  await queueChange("services", "insert", stamp({
    id: internet,
    user_id: userId,
    name: "Telecentro",
    category: "internet",
  }));
  const luzBills = [
    [-4, 100000],
    [-3, 110000],
    [-2, 121000],
    [-1, 133100],
  ];
  for (const [offset, amount] of luzBills) {
    await queueChange("service_bills", "insert", stamp({
      id: crypto.randomUUID(),
      user_id: userId,
      service_id: luz,
      period: periodOf(shiftMonth(now, offset)),
      amount,
    }));
  }
  await queueChange("service_bills", "insert", stamp({
    id: crypto.randomUUID(),
    user_id: userId,
    service_id: internet,
    period: periodOf(shiftMonth(now, -1)),
    amount: 27500,
  }));
}

function renderLoans(loans) {
  const root = document.getElementById("loan-summary");
  const list = document.getElementById("loan-list");
  if (!root || !list) return;
  const month = currentMonth();
  const total = loansInMonth(loans, month, month);
  clear(root);
  clear(list);
  if (loans.length === 0) {
    add(root, "p", "empty", "Todavía no cargaste un préstamo.");
    fillSlot("inicio-prestamos-slot", false);
    return;
  }
  const hero = add(root, "article", "tile tile-prestamos tile-hero tile-stack");
  add(hero, "p", "tile-kicker", "Este mes");
  figures(hero, total, "ars");
  add(root, "h2", "block-title", "Próximos 6 meses");
  forecastList(root, nextMonths().map((entry) => ({
    month: entry,
    amount: loansInMonth(loans, entry, month),
  })), "ars");
  for (const loan of loans) {
    const row = add(list, "li", "manage-row");
    const text = add(row, "div", "manage-copy");
    add(text, "span", "row-title", loan.name);
    if (loan.amortization === "aleman") {
      paintGermanLoan(text, loan);
    } else {
      add(text, "span", "row-meta", `${money(Number(loan.installment_amount), "ARS")} · quedan ${loan.remaining_installments} · termina en ${monthYear(loan.ends_on)}`);
      const thisMonth = loanHits(loan, month, month);
      if (thisMonth > 0) add(text, "span", "row-meta", `Cuota de este mes ${money(thisMonth, "ARS")}`);
    }
    const actions = add(row, "span", "row-actions");
    const edit = add(actions, "button", "", "Editar");
    edit.type = "button";
    edit.addEventListener("click", () => startLoanEdit(loan));
    const remove = add(actions, "button", "", "Borrar");
    remove.type = "button";
    remove.addEventListener("click", () => removeLoan(loan));
  }
  fillSlot("inicio-prestamos-slot", true, total, "ars");
}

function renderSubscriptions(subscriptions) {
  const root = document.getElementById("sub-summary");
  const list = document.getElementById("sub-list");
  if (!root || !list) return;
  const month = currentMonth();
  const totals = subscriptionsInMonth(subscriptions, month);
  clear(root);
  clear(list);
  if (subscriptions.length === 0) {
    add(root, "p", "empty", "Todavía no cargaste una suscripción.");
    fillSlot("inicio-suscripciones-slot", false);
    return;
  }
  const hero = add(root, "article", "tile tile-suscripciones tile-hero tile-stack");
  add(hero, "p", "tile-kicker", "Suma a los fijos");
  figures(hero, totals, "both");
  if (subscriptions.some((subscription) => paidOnCard(subscription))) {
    add(root, "p", "service-note", "Las marcadas “En tarjeta” se cuentan dentro de esa tarjeta. Los cargos futuros se estiman hasta confirmar el resumen.");
  }
  if (totals.USD > 0) add(root, "p", "usd-warning", USD_WARNING);
  add(root, "h2", "block-title", "Próximos 6 meses");
  forecastList(root, nextMonths().map((entry) => ({
    month: entry,
    totals: subscriptionsInMonth(subscriptions, entry),
  })), "both");
  for (const subscription of subscriptions) {
    const row = add(list, "li", "manage-row");
    const text = add(row, "div", "manage-copy");
    const title = add(text, "span", "row-title");
    title.textContent = subscription.name;
    if (paidOnCard(subscription)) add(title, "span", "card-badge", "En tarjeta");
    const meta = add(text, "span", "row-meta");
    meta.append(amountNode(Number(subscription.amount), subscription.currency));
    meta.append(` · ${subscription.frequency} · próximo cobro ${monthYear(subscription.next_charge_on)}`);
    const actions = add(row, "span", "row-actions");
    const edit = add(actions, "button", "", "Editar");
    edit.type = "button";
    edit.addEventListener("click", () => startSubEdit(subscription));
    const remove = add(actions, "button", "", "Borrar");
    remove.type = "button";
    remove.addEventListener("click", () => removeSub(subscription));
  }
  fillSlot("inicio-suscripciones-slot", true, totals, "both");
}

function renderServices(services, bills) {
  const root = document.getElementById("service-summary");
  const list = document.getElementById("service-list");
  const select = document.getElementById("bill-service");
  if (!root || !list || !select) return;
  const month = currentMonth();
  clear(root);
  clear(list);
  const previous = select.value;
  clear(select);
  let total = 0;
  let any = false;
  for (const service of services) {
    const own = bills.filter((bill) => bill.service_id === service.id);
    const result = serviceAmountInMonth(own, month);
    if (result.amount != null) {
      any = true;
      if (!service.card_id) total += result.amount;
    }
    const option = add(select, "option", "", service.name);
    option.value = service.id;
  }
  if (services.some((service) => service.id === previous)) select.value = previous;

  if (services.length === 0) {
    add(root, "p", "empty", "Todavía no cargaste un servicio.");
    fillSlot("inicio-servicios-slot", false);
    return;
  }
  const hero = add(root, "article", "tile tile-servicios tile-hero tile-stack");
  add(hero, "p", "tile-kicker", "Fuera de tarjeta este mes");
  figures(hero, any ? total : 0, "ars");
  if (services.some((row) => row.card_id)) add(root, "p", "service-note", "Los servicios en tarjeta se consultan acá, pero se suman dentro de la tarjeta. Los próximos cargos son estimados.");
  if (!any) add(root, "p", "empty", "Sin facturas para proyectar este mes.");

  for (const service of services) {
    const own = bills.filter((bill) => bill.service_id === service.id);
    const estimate = serviceEstimate(own);
    const result = serviceAmountInMonth(own, month);
    const block = add(list, "li", "service-block");
    add(block, "p", "row-title", `${service.name} · ${categoryLabel(service.category)}${service.card_id ? " · En tarjeta" : ""}`);
    if (estimate.text) add(block, "p", "service-note", estimate.text);
    const periods = own.map((bill) => bill.period);
    if (periods.length !== new Set(periods).size) {
      add(block, "p", "service-note", "Hay más de una factura en el mismo período. El cálculo usa una sola, la más reciente.");
    }
    if (result.amount == null) {
      add(block, "p", "empty", "Sin facturas.");
    } else {
      const label = result.estimated ? "Estimado" : "Facturado";
      add(block, "p", "row-amount", `${label} ${money(result.amount, "ARS")}`);
    }
    const history = [...own].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6);
    for (const bill of history) {
      const row = add(block, "div", "row");
      add(row, "span", "", monthYear(`${bill.period}-01`));
      add(row, "span", "row-amount", money(Number(bill.amount), "ARS"));
      const actions = add(block, "span", "row-actions");
      const edit = add(actions, "button", "", "Editar factura");
      edit.type = "button";
      edit.addEventListener("click", () => startBillEdit(bill));
      const remove = add(actions, "button", "", "Borrar factura");
      remove.type = "button";
      remove.addEventListener("click", () => removeBill(bill));
    }
    const actions = add(block, "span", "row-actions");
    const edit = add(actions, "button", "", "Editar");
    edit.type = "button";
    edit.addEventListener("click", () => startServiceEdit(service));
    const remove = add(actions, "button", "", "Borrar");
    remove.type = "button";
    remove.addEventListener("click", () => removeService(service, own));
  }
  fillSlot("inicio-servicios-slot", services.length > 0 && any, total, "ars");
}

function percentText(value) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(Number(value));
}

function paintGermanLoan(text, loan) {
  add(text, "span", "row-meta", `Cuota decreciente · capital ${money(Number(loan.remaining_principal), "ARS")} · TEM ${percentText(loan.tem)}% · quedan ${loan.remaining_installments} · termina en ${monthYear(loan.ends_on)}`);
  if (loan.cft != null && loan.cft !== "") {
    add(text, "span", "row-meta", `El CFT es ${percentText(loan.cft)}%. Es una referencia del costo del préstamo: no entra en la cuota ni en los totales.`);
  }
  const diff = bankDifference(loan);
  if (diff) {
    const size = money(Math.abs(diff.gap), "ARS");
    const direction = diff.gap > 0 ? "más" : "menos";
    const used = loan.adjust_bank
      ? "Está sumada a cada cuota porque pediste ajustar con la cuota del banco."
      : "No entra en los totales: es solo para comparar.";
    add(text, "p", "service-note", `El banco dice ${money(diff.bank, "ARS")} y el cálculo da ${money(diff.calculated, "ARS")} (${size} ${direction}, ${BANK_GAP_NOTE}). ${used}`);
  }
  const schedule = germanSchedule(loan);
  const gap = loan.adjust_bank && diff ? diff.gap : 0;
  const list = add(text, "ol", "loan-schedule");
  for (const row of schedule) {
    const installment = roundMoney(row.installment + gap);
    add(list, "li", "", `Cuota ${row.number}: ${money(installment, "ARS")} · capital ${money(row.amortization, "ARS")} + interés ${money(row.interest, "ARS")}`);
  }
}

function parseAmount(value) {
  if (String(value ?? "").trim() === "") return null;
  return Number(String(value).replace(",", "."));
}

function syncLoanForm() {
  const form = document.getElementById("loan-form");
  const german = field(form, "amortization").value === "aleman";
  form.querySelectorAll("[data-loan]").forEach((node) => {
    node.hidden = node.dataset.loan === "aleman" ? !german : german;
  });
  field(form, "installment_amount").required = !german;
  field(form, "remaining_principal").required = german;
  field(form, "tem").required = german;
}

function startLoanEdit(loan) {
  const form = document.getElementById("loan-form");
  editingLoanId = loan.id;
  field(form, "name").value = loan.name;
  field(form, "amortization").value = loan.amortization === "aleman" ? "aleman" : "fija";
  field(form, "installment_amount").value = loan.installment_amount ?? "";
  field(form, "remaining_principal").value = loan.remaining_principal ?? "";
  field(form, "tem").value = loan.tem ?? "";
  field(form, "cft").value = loan.cft ?? "";
  field(form, "current_installment_bank").value = loan.current_installment_bank ?? "";
  field(form, "adjust_bank").checked = Boolean(loan.adjust_bank);
  field(form, "remaining_installments").value = loan.remaining_installments;
  field(form, "ends_on").value = String(loan.ends_on).slice(0, 10);
  syncLoanForm();
  document.getElementById("loan-submit").textContent = "Guardar cambios";
}

function resetLoanForm() {
  editingLoanId = null;
  const form = document.getElementById("loan-form");
  form.reset();
  field(form, "amortization").value = "fija";
  field(form, "adjust_bank").checked = false;
  syncLoanForm();
  document.getElementById("loan-submit").textContent = "Agregar préstamo";
  document.getElementById("loan-form-error").textContent = "";
}

function startSubEdit(subscription) {
  const form = document.getElementById("sub-form");
  editingSubId = subscription.id;
  field(form, "name").value = subscription.name;
  field(form, "amount").value = subscription.amount;
  field(form, "currency").value = subscription.currency;
  field(form, "frequency").value = subscription.frequency;
  field(form, "next_charge_on").value = String(subscription.next_charge_on).slice(0, 10);
  field(form, "on_card").checked = paidOnCard(subscription);
  field(form, "card_id").value = subscription.card_id || "";
  document.getElementById("sub-submit").textContent = "Guardar cambios";
}

function resetSubForm() {
  editingSubId = null;
  const form = document.getElementById("sub-form");
  form.reset();
  field(form, "currency").value = "ARS";
  field(form, "frequency").value = "mensual";
  field(form, "next_charge_on").value = todayIso();
  field(form, "on_card").checked = false;
  document.getElementById("sub-submit").textContent = "Agregar suscripción";
  document.getElementById("sub-form-error").textContent = "";
}

function startServiceEdit(service) {
  const form = document.getElementById("service-form");
  editingServiceId = service.id;
  field(form, "name").value = service.name;
  field(form, "card_id").value = service.card_id || "";
  const select = field(form, "category");
  select.querySelectorAll("[data-legacy]").forEach((node) => node.remove());
  const stored = service.category === "celular" ? "linea_celular" : service.category;
  if (![...select.options].some((option) => option.value === stored)) {
    const option = document.createElement("option");
    option.value = service.category;
    option.textContent = categoryLabel(service.category);
    option.dataset.legacy = "1";
    select.append(option);
    select.value = service.category;
  } else {
    select.value = stored;
  }
  document.getElementById("service-submit").textContent = "Guardar cambios";
}

function resetServiceForm() {
  editingServiceId = null;
  const form = document.getElementById("service-form");
  form.reset();
  field(form, "category").querySelectorAll("[data-legacy]").forEach((node) => node.remove());
  document.getElementById("service-submit").textContent = "Agregar servicio";
  document.getElementById("service-form-error").textContent = "";
}

function startBillEdit(bill) {
  const form = document.getElementById("bill-form");
  editingBillId = bill.id;
  field(form, "service_id").value = bill.service_id;
  field(form, "period").value = bill.period;
  field(form, "amount").value = bill.amount;
  document.getElementById("bill-submit").textContent = "Guardar factura";
}

function resetBillForm() {
  editingBillId = null;
  const form = document.getElementById("bill-form");
  form.reset();
  field(form, "period").value = periodOf(shiftMonth(currentMonth(), -1));
  document.getElementById("bill-submit").textContent = "Cargar factura";
  document.getElementById("bill-form-error").textContent = "";
}

async function removeLoan(loan) {
  if (!confirm(`¿Borrar ${loan.name}?`)) return;
  await queueChange("loans", "delete", { id: loan.id });
  if (editingLoanId === loan.id) resetLoanForm();
}

async function removeSub(subscription) {
  if (!confirm(`¿Borrar ${subscription.name}?`)) return;
  await detachCharges("subscription_id", subscription.id);
  await queueChange("subscriptions", "delete", { id: subscription.id });
  if (editingSubId === subscription.id) resetSubForm();
}

async function removeBill(bill) {
  if (!confirm("¿Borrar esta factura?")) return;
  await detachCharges("service_bill_id", bill.id);
  await queueChange("service_bills", "delete", { id: bill.id });
  if (editingBillId === bill.id) resetBillForm();
}

async function removeService(service, bills) {
  if (!confirm(`¿Borrar ${service.name} y sus facturas?`)) return;
  for (const bill of bills) {
    await detachCharges("service_bill_id", bill.id);
    await queueChange("service_bills", "delete", { id: bill.id });
  }
  await queueChange("services", "delete", { id: service.id });
  if (editingServiceId === service.id) resetServiceForm();
}

async function detachCharges(field, id) {
  for (const item of await listRows("card_items")) {
    if (item[field] === id) await queueChange("card_items", "update", stamp({ ...item, [field]: null }));
  }
}

function wireForms() {
  if (wired) return;
  wired = true;
  const loanForm = document.getElementById("loan-form");
  const subForm = document.getElementById("sub-form");
  const serviceForm = document.getElementById("service-form");
  const billForm = document.getElementById("bill-form");
  field(subForm, "next_charge_on").value = todayIso();
  field(billForm, "period").value = periodOf(shiftMonth(currentMonth(), -1));
  field(loanForm, "amortization").addEventListener("change", syncLoanForm);
  syncLoanForm();

  loanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("loan-form-error");
    error.textContent = "";
    const name = redactLongNumbers(field(loanForm, "name").value.trim());
    const german = field(loanForm, "amortization").value === "aleman";
    const remainingRaw = String(field(loanForm, "remaining_installments").value).trim();
    const remaining = Number(remainingRaw);
    const endsOn = field(loanForm, "ends_on").value;
    const missing = [];
    if (!name) missing.push("nombre");
    if (remainingRaw === "") missing.push("cuotas restantes");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) missing.push("fecha de fin");
    let amount = parseAmount(field(loanForm, "installment_amount").value);
    let principal = null;
    let tem = null;
    let cft = null;
    let bank = null;
    let adjust = false;
    if (german) {
      const principalRaw = String(field(loanForm, "remaining_principal").value).trim();
      const temRaw = String(field(loanForm, "tem").value).trim();
      principal = parseAmount(principalRaw);
      tem = parseAmount(temRaw);
      cft = parseAmount(field(loanForm, "cft").value);
      bank = parseAmount(field(loanForm, "current_installment_bank").value);
      adjust = field(loanForm, "adjust_bank").checked;
      if (principalRaw === "") missing.push("capital restante");
      if (temRaw === "") missing.push("TEM");
      if (missing.length) {
        error.textContent = `Completá: ${missing.join(", ")}.`;
        return;
      }
      if (!Number.isFinite(principal) || principal <= 0) {
        error.textContent = "El capital restante no es válido.";
        return;
      }
      if (!Number.isFinite(tem) || tem < 0) {
        error.textContent = "La TEM no es válida.";
        return;
      }
      if (!Number.isInteger(remaining) || remaining < 1) {
        error.textContent = "Las cuotas restantes tienen que ser un número entero mayor a cero.";
        return;
      }
      if (cft != null && (!Number.isFinite(cft) || cft < 0)) {
        error.textContent = "La CFT no es válida. Si no la tenés, dejala vacía: no entra en la cuota.";
        return;
      }
      if (bank != null && (!Number.isFinite(bank) || bank < 0)) {
        error.textContent = "La cuota del banco no es válida. Si no la tenés, dejala vacía.";
        return;
      }
    } else {
      if (String(field(loanForm, "installment_amount").value).trim() === "") missing.push("cuota");
      if (missing.length) {
        error.textContent = `Completá: ${missing.join(", ")}.`;
        return;
      }
      if (!Number.isInteger(remaining) || remaining < 0) {
        error.textContent = "Las cuotas restantes tienen que ser un número entero.";
        return;
      }
    }
    if (german) {
      const schedule = germanSchedule({
        remaining_principal: principal,
        remaining_installments: remaining,
        tem,
      });
      if (schedule.length === 0) {
        error.textContent = "No se puede armar la cuota.";
        return;
      }
      amount = schedule[0].installment;
    } else if (!Number.isFinite(amount) || amount < 0) {
      error.textContent = "La cuota no es válida.";
      return;
    }
    const existing = editingLoanId
      ? (await listRows("loans")).find((loan) => loan.id === editingLoanId)
      : null;
    await queueChange("loans", editingLoanId ? "update" : "insert", stamp({
      id: editingLoanId || crypto.randomUUID(),
      user_id: userId,
      name,
      installment_amount: amount,
      remaining_installments: remaining,
      ends_on: endsOn,
      amortization: german ? "aleman" : "fija",
      remaining_principal: principal,
      tem,
      cft,
      current_installment_bank: bank,
      adjust_bank: adjust,
      created_at: existing?.created_at,
    }));
    resetLoanForm();
  });

  subForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("sub-form-error");
    error.textContent = "";
    const name = redactLongNumbers(field(subForm, "name").value.trim());
    const amount = Number(String(field(subForm, "amount").value).replace(",", "."));
    const currency = field(subForm, "currency").value;
    const frequency = field(subForm, "frequency").value;
    const nextCharge = field(subForm, "next_charge_on").value;
    const onCard = Boolean(field(subForm, "on_card").checked);
    const cardId = onCard ? field(subForm, "card_id").value : null;
    if (onCard && !cardId) {
      error.textContent = "Elegí la tarjeta que paga esta suscripción.";
      return;
    }
    if (!name) {
      error.textContent = "Poné un nombre.";
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      error.textContent = "El monto no es válido.";
      return;
    }
    if (currency !== "ARS" && currency !== "USD") return;
    if (frequency !== "mensual" && frequency !== "anual") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextCharge)) {
      error.textContent = "Elegí el próximo cobro.";
      return;
    }
    const existing = editingSubId
      ? (await listRows("subscriptions")).find((row) => row.id === editingSubId)
      : null;
    await queueChange("subscriptions", editingSubId ? "update" : "insert", stamp({
      ...existing,
      id: editingSubId || crypto.randomUUID(),
      user_id: userId,
      name,
      amount,
      currency,
      frequency,
      next_charge_on: nextCharge,
      on_card: onCard,
      card_id: cardId || null,
      created_at: existing?.created_at,
    }));
    resetSubForm();
  });

  serviceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("service-form-error");
    error.textContent = "";
    const name = redactLongNumbers(field(serviceForm, "name").value.trim());
    const category = field(serviceForm, "category").value;
    if (!name) {
      error.textContent = "Poné un nombre.";
      return;
    }
    const existing = editingServiceId
      ? (await listRows("services")).find((row) => row.id === editingServiceId)
      : null;
    const known = CATEGORIES.some(([value]) => value === category);
    if (!known && !(existing && existing.category === category)) {
      error.textContent = "Elegí una categoría.";
      return;
    }
    await queueChange("services", editingServiceId ? "update" : "insert", stamp({
      ...existing,
      id: editingServiceId || crypto.randomUUID(),
      user_id: userId,
      name,
      category,
      card_id: field(serviceForm, "card_id").value || null,
      created_at: existing?.created_at,
    }));
    resetServiceForm();
  });

  billForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("bill-form-error");
    error.textContent = "";
    const serviceId = field(billForm, "service_id").value;
    const period = field(billForm, "period").value;
    const amount = Number(String(field(billForm, "amount").value).replace(",", "."));
    if (!serviceId) {
      error.textContent = "Primero cargá un servicio.";
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      error.textContent = "Elegí el período.";
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      error.textContent = "El monto no es válido.";
      return;
    }
    const bills = await listRows("service_bills");
    if (duplicateBill(bills, serviceId, period, editingBillId)) {
      error.textContent = "Ya hay una factura de este servicio para ese período. Editala si querés cambiar el monto.";
      return;
    }
    const existing = editingBillId ? bills.find((row) => row.id === editingBillId) : null;
    await queueChange("service_bills", editingBillId ? "update" : "insert", stamp({
      id: editingBillId || crypto.randomUUID(),
      user_id: userId,
      service_id: serviceId,
      period,
      amount,
      created_at: existing?.created_at,
    }));
    resetBillForm();
  });
}

export async function renderPlanes() {
  wireForms();
  const [loans, subscriptions, services, bills, cards] = await Promise.all([
    listRows("loans"),
    listRows("subscriptions"),
    listRows("services"),
    listRows("service_bills"),
    listRows("cards"),
  ]);
  for (const id of ["service-card", "sub-card"]) {
    const select = document.getElementById(id);
    if (!select) continue;
    const value = select.value;
    select.replaceChildren();
    add(select, "option", "", id === "service-card" ? "Fuera de tarjeta" : "Elegí una tarjeta").value = "";
    for (const card of cards) add(select, "option", "", card.name).value = card.id;
    select.value = cards.some((row) => row.id === value) ? value : "";
  }
  renderLoans(loans);
  renderSubscriptions(subscriptions);
  renderServices(services, bills);
}

export function watchPlans() {
  onData(() => {
    renderPlanes();
  });
}
