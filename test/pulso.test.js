import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDashboard, dailySummary, chargeKind } from '../pulso-model.js';
const card = { id: 'visa', due_day: 11, closing_day: 29 };
const item = (id, amount, extra = {}) => ({ id, card_id: 'visa', amount, currency: 'ARS', spent_on: '2026-10-10', statement_due_on: '2026-11-11', ...extra });
test('Pulso avanza al próximo vencimiento después del día de pago, sin marcar cuotas pagadas', () => {
  const data = { cards: [card], cardItems: [item('a',100,{installment_number:2,installment_count:4})] };
  const report = cardDashboard(data, card, '2026-11-12');
  assert.equal(report.due,'2026-12-11');
  assert.equal(report.current.charges[0].installment_number,3);
  assert.equal(report.current.totals.ARS,100);
});
test('la baja separa última cuota, compra puntual y recurrentes; conserva USD', () => {
  const data = { cards:[card], cardItems:[item('last',32,{installment_number:12,installment_count:12}),item('one',64),item('sub',24,{currency:'USD',subscription_id:'s'})], subscriptions:[{id:'s',name:'Streaming',on_card:true,card_id:'visa',amount:24,currency:'USD',frequency:'mensual',next_charge_on:'2026-11-10'}] };
  const report = cardDashboard(data,card,'2026-11-06');
  assert.equal(report.ending.ARS,32); assert.equal(report.oneOff.ARS,64);
  assert.equal(report.oneOff.USD,0); assert.equal(report.next.totals.USD,24);
  assert.equal(report.delta.ARS,-96); assert.equal(report.delta.USD,0);
  assert.equal(chargeKind({id:'estimate:service:x'}),'Servicios');
});
test('gastos diarios filtra el mes y agrupa monedas sin mezclarlas con tarjetas', () => {
  const data = dailySummary([{spent_on:'2026-11-02',amount:15,currency:'ARS',category:'Comida'},{spent_on:'2026-11-03',amount:5,currency:'USD',category:'Comida'},{spent_on:'2026-10-01',amount:900,currency:'ARS'}],'2026-11');
  assert.deepEqual(data.totals,{ARS:15,USD:5}); assert.equal(data.rows.length,2); assert.equal(data.categories.length,1);
});
