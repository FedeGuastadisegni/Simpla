// Validación aislada con PostgreSQL embebido. No se conecta a Supabase.
// Uso: node scripts/validate-period-schema.mjs /ruta/a/pglite/dist/index.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Indicá la ruta del módulo PGlite instalado fuera del proyecto.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const allowedEmail = /ALLOWED_EMAIL = "([^"]+)"/.exec(read("config.js"))[1];
const schema = read("supabase/schema.sql").replaceAll(allowedEmail, "owner@example.invalid");
const marker = "-- Períodos de tarjeta y vínculos";
const legacySchema = schema.slice(0, schema.indexOf(marker));
const migration = read("supabase/migrations/20261106012407_card_statement_periods.sql");
const classificationMigration = read("supabase/migrations/20261106030439_classify_card_items.sql");
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const card = "00000000-0000-4000-8000-000000000003";
const item = "00000000-0000-4000-8000-000000000004";
const sub = "00000000-0000-4000-8000-000000000005";
const service = "00000000-0000-4000-8000-000000000006";
const bill = "00000000-0000-4000-8000-000000000007";

for (const mode of ["migración de una base existente", "esquema nuevo"]) {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth to public;
    `);
    await db.exec(mode === "esquema nuevo" ? schema : legacySchema);
    await db.exec(`
      insert into auth.users values ('${user}', 'owner@example.invalid'), ('${other}', 'owner@example.invalid');
      insert into public.cards (id, user_id, name, due_day) values ('${card}', '${user}', 'VISA', 11);
      insert into public.card_items (id, user_id, card_id, description, amount, currency, spent_on)
        values ('${item}', '${user}', '${card}', 'Compra anterior', 100, 'ARS', '2026-10-05');
    `);
    // La migración es repetible y no modifica ni inventa períodos anteriores.
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(classificationMigration);
    await db.exec(classificationMigration);
    let result = await db.query("select description, statement_due_on from public.card_items");
    assert.equal(result.rows[0].description, "Compra anterior");
    assert.equal(result.rows[0].statement_due_on, null);
    await db.exec(`
      update public.card_items set statement_closes_on = '2026-10-29', statement_due_on = '2026-11-11' where id = '${item}';
      insert into public.subscriptions (id, user_id, name, amount, currency, frequency, next_charge_on)
        values ('${sub}', '${user}', 'Streaming', 10, 'USD', 'mensual', '2026-11-05');
      insert into public.services (id, user_id, name, category) values ('${service}', '${user}', 'Internet', 'internet');
      insert into public.service_bills (id, user_id, service_id, period, amount)
        values ('${bill}', '${user}', '${service}', '2026-10', 100);
      update public.card_items set subscription_id = '${sub}' where id = '${item}';
    `);
    await assert.rejects(db.exec(`update public.card_items set statement_due_on = '2026-10-01' where id = '${item}'`), /card_items_statement_dates_check/);
    await assert.rejects(db.exec(`update public.card_items set service_bill_id = '${bill}' where id = '${item}'`), /card_items_single_link_check/);
    await db.exec(`delete from public.subscriptions where id = '${sub}'`);
    result = await db.query("select user_id, subscription_id from public.card_items");
    assert.equal(result.rows[0].user_id, user);
    assert.equal(result.rows[0].subscription_id, null);
    await db.exec(`update public.card_items set service_bill_id = '${bill}' where id = '${item}'`);
    await db.exec(`delete from public.services where id = '${service}'`);
    result = await db.query("select service_bill_id from public.card_items");
    assert.equal(result.rows[0].service_bill_id, null);
    await db.exec(`
      insert into public.subscriptions (id, user_id, name, amount, currency, frequency, next_charge_on)
        values ('${sub}', '${other}', 'Ajena', 10, 'USD', 'mensual', '2026-11-05');
    `);
    await assert.rejects(db.exec(`update public.card_items set subscription_id = '${sub}' where id = '${item}'`), /card_items_subscription_fkey/);
    await assert.rejects(db.exec(`update public.subscriptions set card_id = '${card}' where id = '${sub}'`), /subscriptions_card_fkey/);
    await db.exec(`insert into public.services (id, user_id, name, category, card_id)
      values ('${service}', '${user}', 'Internet', 'internet', '${card}');`);
    await db.exec(`insert into public.subscriptions (id, user_id, name, amount, currency, frequency, next_charge_on, card_id)
      values ('00000000-0000-4000-8000-000000000008', '${user}', 'Streaming', 10, 'USD', 'mensual', '2026-11-05', '${card}');`);
    // Borrar una tarjeta conserva las entidades y limpia solo el medio de pago.
    await db.exec(`delete from public.cards where id = '${card}'`);
    result = await db.query(`select (select card_id from public.services where id='${service}') as service_card,
      (select card_id from public.subscriptions where id='00000000-0000-4000-8000-000000000008') as subscription_card`);
    assert.equal(result.rows[0].service_card, null);
    assert.equal(result.rows[0].subscription_card, null);
    // Reponer una fila para comprobar el aislamiento RLS después de las migraciones.
    await db.exec(`insert into public.cards (id,user_id,name,due_day) values ('${card}','${user}','VISA',11);
      insert into public.card_items (id,user_id,card_id,description,amount,currency,spent_on)
      values ('${item}','${user}','${card}','Prueba',100,'ARS','2026-11-05');`);
    result = await db.query(`select count(*)::int as count from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity`);
    assert.equal(result.rows[0].count, 7);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);
      select set_config('request.jwt.claims', '{"email":"owner@example.invalid"}', false);`);
    result = await db.query("select count(*)::int as count from public.card_items");
    assert.equal(result.rows[0].count, 1);
    await db.exec(`select set_config('request.jwt.claim.sub', '${other}', false)`);
    result = await db.query("select count(*)::int as count from public.card_items");
    assert.equal(result.rows[0].count, 0);
    console.log(`OK: ${mode}; idempotencia, datos anteriores, vínculos, borrados, fechas y RLS.`);
  } finally {
    await db.close();
  }
}
