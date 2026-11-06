import { foldName, planStatementImport } from "./statement-parser.js";
import { fromMonthKey, monthKey, parseIsoDate } from "./card-math.js";
import { CATEGORIES } from "./service-categories.js";
import { chargeDay, latestCharge, shiftChargeDate } from "./recurring.js";
import { redactLongNumbers } from "./privacy.js";

export function itemClassification(item, data) {
  const subscription = (data.subscriptions || []).find((row) => row.id === item?.subscription_id);
  if (subscription) return { kind: "subscription", target_id: subscription.id, name: subscription.name, frequency: subscription.frequency };
  const bill = (data.serviceBills || []).find((row) => row.id === item?.service_bill_id);
  const service = (data.services || []).find((row) => row.id === bill?.service_id);
  if (service) return { kind: "service", target_id: service.id, name: service.name, category: service.category, period: bill.period };
  return { kind: "normal", target_id: "", name: "" };
}

export function suggestClassification(row, cardId, data) {
  const matches = (data.cardItems || []).filter((item) => item.card_id === cardId
    && item.currency === row.currency && foldName(item.description) === foldName(row.description));
  const item = latestCharge(matches);
  const suggested = itemClassification(item, data);
  let period = row.spent_on?.slice(0, 7) || "";
  const previous = parseIsoDate(item?.spent_on);
  const current = parseIsoDate(row.spent_on);
  const billed = parseIsoDate(`${suggested.period}-01`);
  if (suggested.kind === "service" && previous && current && billed) {
    const shifted = fromMonthKey(monthKey(billed.year, billed.month)
      + monthKey(current.year, current.month) - monthKey(previous.year, previous.month));
    period = `${shifted.year}-${String(shifted.month + 1).padStart(2, "0")}`;
  }
  return { ...suggested, period, suggested: Boolean(item) };
}

export function planClassifiedImport(rows, cardId, data, makeId = () => crypto.randomUUID()) {
  const parsed = planStatementImport(rows, cardId, data.cardItems || []);
  if (!parsed.ok) return parsed;
  const working = {
    services: [...data.services || []], service_bills: [...data.serviceBills || []],
    subscriptions: [...data.subscriptions || []], card_items: [...data.cardItems || []],
  };
  const original = Object.fromEntries(Object.entries(working).map(([table, records]) => [table, new Map(records.map((row) => [row.id, row]))]));
  const changes = new Map();
  const created = new Map();
  function put(table, row) {
    const before = original[table].get(row.id);
    const index = working[table].findIndex((item) => item.id === row.id);
    if (index < 0) working[table].push(row); else working[table][index] = row;
    if (before && Object.keys(row).every((key) => row[key] === before[key])) return;
    changes.set(`${table}:${row.id}`, { table, op: before ? "update" : "insert", row });
  }
  try {
    parsed.rows.forEach((planned, index) => {
      const input = rows[index];
      if (input.selected === false || planned.status === "ignored") return;
      // Una repetición dentro del archivo no crea otra entidad.
      if (planned.status === "loaded" && !planned.existingId) return;
      const previous = working.card_items.find((row) => row.id === planned.existingId);
      const { status, reason, selected, existingId, hadMatch, ...charge } = planned;
      // Un resumen anterior nunca retrocede una cuota ya confirmada.
      const item = planned.status === "loaded" ? { ...previous } : { ...previous, ...charge, id: previous?.id || makeId() };
      if (!item.id) return;
      const classification = input.classification || itemClassification(previous, data);
      if (!["normal", "subscription", "service"].includes(classification.kind)) throw new Error("Elegí un tipo de gasto válido.");
      item.subscription_id = null;
      item.service_bill_id = null;
      if (classification.kind !== "normal") {
        if (item.installment_count != null) throw new Error("Clasificá como suscripción o servicio solo cargos en un pago.");
        const table = classification.kind === "subscription" ? "subscriptions" : "services";
        const target = classification.target_id;
        let entity = target && target !== "new" ? working[table].find((row) => row.id === target) : null;
        if (target && target !== "new" && !entity) throw new Error("El registro elegido ya no existe. Revisá la clasificación.");
        const name = redactLongNumbers(String(classification.name || entity?.name || item.description).trim());
        if (!name) throw new Error("Indicá un nombre para la suscripción o servicio.");
        const newKey = `${table}:${foldName(name)}`;
        if (!entity && created.has(newKey)) entity = working[table].find((row) => row.id === created.get(newKey));
        const id = entity?.id || makeId();
        if (table === "subscriptions") {
          if (entity && entity.currency !== item.currency) throw new Error("La suscripción elegida tiene otra moneda.");
          const frequency = classification.frequency || entity?.frequency || "mensual";
          if (!["mensual", "anual"].includes(frequency)) throw new Error("Elegí frecuencia mensual o anual.");
          const last = latestCharge(working.card_items.filter((row) => row.subscription_id === id));
          const newer = !last || item.spent_on >= last.spent_on;
          const history = working.card_items.filter((row) => row.subscription_id === id);
          const next = shiftChargeDate(item.spent_on, frequency === "anual" ? 12 : 1, chargeDay(item.spent_on, history));
          put(table, {
            ...entity, id, name: entity?.name || name,
            amount: newer ? item.amount : entity.amount, currency: item.currency,
            frequency, next_charge_on: newer ? next : entity.next_charge_on,
            on_card: true, card_id: newer ? cardId : entity.card_id,
          });
          item.subscription_id = id;
        } else {
          if (item.currency !== "ARS") throw new Error("Los servicios se registran en ARS. Para USD usá suscripción o compra normal.");
          const category = classification.category || entity?.category;
          if (!CATEGORIES.some(([code]) => code === category) && category !== entity?.category) throw new Error("Elegí una categoría de servicio.");
          if (!category) throw new Error("Elegí una categoría de servicio.");
          const period = classification.period;
          if (!/^\d{4}-\d{2}$/.test(period || "") || !parseIsoDate(`${period}-01`)) throw new Error("Indicá el período facturado del servicio.");
          put(table, { ...entity, id, name: entity?.name || name, category, card_id: cardId });
          const bill = working.service_bills.find((row) => row.service_id === id && row.period === period);
          if (bill && working.card_items.some((row) => row.service_bill_id === bill.id && row.id !== item.id)) {
            throw new Error("Ese período del servicio ya está vinculado a otro consumo. Revisá si es un cargo duplicado.");
          }
          const billId = bill?.id || makeId();
          put("service_bills", { ...bill, id: billId, service_id: id, period, amount: item.amount });
          item.service_bill_id = billId;
        }
        if (!entity) created.set(newKey, id);
      }
      put("card_items", item);
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const order = ["services", "subscriptions", "service_bills", "card_items"];
  const ops = [...changes.values()].sort((a, b) => order.indexOf(a.table) - order.indexOf(b.table));
  return { ...parsed, ops };
}
