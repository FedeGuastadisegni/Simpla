import { cardDashboard, dailySummary } from './pulso-model.js';
import { listRows, onData } from './db.js';

const money = (n, currency = 'ARS') => new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
const totals = value => `${money(value.ARS)}${value.USD ? ` + USD ${Number(value.USD).toLocaleString('es-AR')}` : ''}`;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function row(root, title, value, detail) {
  const line = el('div', null, 'pulse-row');
  const copy = el('div'); copy.append(el('strong', title));
  if (detail) copy.append(el('small', detail));
  line.append(copy, el('span', value, 'pulse-value')); root.append(line);
}
function panel(title) { const node = el('section', null, 'pulse-panel'); node.append(el('h2', title)); return node; }
let chosen;
let revision = 0;
export async function renderPulso() {
  const token = ++revision;
  const names = ['cards', 'card_items', 'subscriptions', 'services', 'service_bills', 'expenses'];
  const [cards, cardItems, subscriptions, services, serviceBills, expenses] = await Promise.all(names.map(listRows));
  if (token !== revision) return;
  const data = { cards, cardItems, subscriptions, services, serviceBills };
  const root = document.getElementById('pulso-dashboard');
  if (!root) return;
  root.replaceChildren();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const heading = el('div', null, 'pulse-heading d-flex flex-wrap');
  heading.append(el('h1', 'Tu próximo vencimiento, claro.'));
  const importLink = el('a', 'Importar resumen', 'btn-primary'); importLink.href = '#tarjeta'; heading.append(importLink); root.append(heading);
  if (!cards.length) {
    const empty = panel('Empezá por tu tarjeta'); empty.append(el('p', 'Importá un resumen o agregá una tarjeta para anticipar tus próximos pagos.')); root.append(empty);
  } else {
    if (!cards.some(card => card.id === chosen)) chosen = [...cards].sort((a,b) => (cardDashboard(data,a,today)?.due || '9999').localeCompare(cardDashboard(data,b,today)?.due || '9999'))[0].id;
    const label = el('label', 'Tarjeta', 'pulse-picker');
    const select = el('select'); select.setAttribute('aria-label', 'Tarjeta del próximo vencimiento');
    cards.forEach(card => { const option = el('option', card.name); option.value = card.id; option.selected = chosen === card.id; select.append(option); });
    select.onchange = () => { chosen = select.value; renderPulso(); }; label.append(select); root.append(label);
    const card = cards.find(card => card.id === chosen);
    const model = cardDashboard(data, card, today);
    if (model) {
      const grid = el('div', null, 'pulse-grid');
      const hero = panel(card.name); hero.classList.add('pulse-hero');
      hero.append(el('p', `Próximo vencimiento · ${model.due.split('-').reverse().join('/')}`), el('div', money(model.current.totals.ARS), 'pulse-amount'));
      if (model.current.totals.USD) hero.append(el('p', `+ USD ${model.current.totals.USD.toLocaleString('es-AR')}`, 'pulse-usd'));
      hero.append(el('small', `Incluye ${totals(model.estimated)} estimados. Total de consumos registrados; verificá el saldo final del resumen.`));
      const comparison = panel('Qué cambia en el siguiente período');
      comparison.append(el('p', totals(model.next.totals), 'pulse-total'));
      row(comparison, 'Cuotas que terminan', totals(model.ending), 'Importe que deja de repetirse');
      row(comparison, 'Compras puntuales', totals(model.oneOff), 'Un pago · excluye servicios y suscripciones');
      row(comparison, 'Nuevos cargos y variaciones', totals(model.other));
      row(comparison, 'Variación neta', totals(model.delta), 'Negativo: baja · positivo: sube');
      comparison.append(el('small', 'Proyección con lo registrado. Los nuevos consumos pueden cambiarla.'));
      const breakdown = panel('Qué vas a pagar');
      Object.entries(model.groups).forEach(([kind,value]) => row(breakdown,kind,totals(value)));
      const history = panel('Avance de cuotas');
      const installments = model.current.charges.filter(item => Number(item.installment_count) > 1);
      if (!installments.length) history.append(el('p','No hay cuotas en este vencimiento.'));
      installments.forEach(item => {
        const n = Number(item.installment_number), total = Number(item.installment_count);
        row(history,item.description,money(Number(item.amount),item.currency),`Cuota ${n}/${total} · ${n-1} anteriores · ${total-n+1} pendientes en el cronograma`);
        const progress = el('progress'); progress.max = total; progress.value = n-1; progress.setAttribute('aria-label',`${item.description}: ${n-1} cuotas anteriores de ${total}`); history.append(progress);
      });
      const details = el('details'); details.append(el('summary', 'Ver historial de períodos registrados'));
      cardItems.filter(item => item.card_id === card.id && Number(item.installment_count)>1).forEach(item => row(details,item.description,`Cuota ${item.installment_number}/${item.installment_count}`,`Vencimiento registrado: ${item.statement_due_on || 'Sin confirmar'}`));
      history.append(details,el('small','Las cuotas anteriores corresponden al cronograma. La app todavía no registra la confirmación de pagos.'));
      grid.append(hero,comparison,breakdown,history); root.append(grid);
    }
  }
  const daily = document.getElementById('daily-content');
  const input = document.getElementById('daily-period');
  if (!input.value) input.value = today.slice(0,7);
  input.onchange = renderPulso;
  const report = dailySummary(expenses,input.value); daily.replaceChildren();
  const total = panel('Gastos diarios del mes'); total.append(el('p',totals(report.totals),'pulse-amount')); daily.append(total);
  const categories = panel('En qué gastaste'); report.categories.forEach(cat => row(categories,cat.name,totals(cat.totals))); daily.append(categories);
  const movements = panel('Movimientos'); report.rows.forEach(item => row(movements,item.description || 'Gasto',money(Number(item.amount),item.currency),`${item.spent_on} · ${item.category || 'Sin categoría'}`));
  if (!report.rows.length) movements.append(el('p','Todavía no hay gastos diarios registrados en este mes. La carga y captura automática se incorporarán en la segunda etapa.'));
  daily.append(movements);
}
export function watchPulso() { onData(renderPulso); }
