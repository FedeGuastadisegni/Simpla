# Supabase

## Actualizar una base existente: períodos de tarjeta

Antes de publicar esta versión, ejecutá en SQL Editor el archivo `supabase/migrations/20261106012407_card_statement_periods.sql`. Es transaccional e idempotente: agrega fechas de cierre/vencimiento y vínculos opcionales a suscripciones o facturas, sin borrar registros ni asignar fechas inventadas a los consumos anteriores.

Las claves foráneas incluyen `user_id`: un consumo no puede vincularse con una suscripción o factura de otro usuario. Al borrar la entidad vinculada se conserva el consumo y se limpia únicamente el vínculo. Las políticas RLS existentes se mantienen.

Los consumos anteriores deben reimportarse o editarse para confirmar el vencimiento de su cuota actual. El esquema de una instalación nueva ya incluye estos campos. Los backups siguen siendo versión 1 y admiten los campos adicionales; los anteriores siguen siendo legibles, pero no pueden recuperar información que nunca guardaron.

La app no persiste documentos ni texto extraído. Las columnas nuevas conservan exclusivamente fechas de los períodos y referencias a registros confirmados.

### Validar el SQL sin acceder a producción

`scripts/validate-period-schema.mjs` comprueba una instalación nueva y la actualización de una base anterior con PostgreSQL embebido (PGlite). Instalá PGlite fuera del proyecto y ejecutá:

```text
node scripts/validate-period-schema.mjs /ruta/a/node_modules/@electric-sql/pglite/dist/index.js
```

La comprobación utiliza identidades ficticias y cubre idempotencia, conservación de filas, fechas inválidas, vínculos entre usuarios, eliminación de vínculos y RLS. No se conecta a Supabase remoto. Las pruebas de lógica e importación se ejecutan con `npm test`.

## Pegar el SQL

1. Entrá al proyecto en [supabase.com](https://supabase.com).
2. Abrí **SQL Editor** y una consulta nueva.
3. Pegá todo el archivo `supabase/schema.sql` y dale a **Run**.
4. Se puede correr de nuevo: no borra filas.

El script crea las tablas, prende RLS y lo fuerza, y deja políticas de lectura, alta, cambio y baja. Solo pasan si `user_id` es el usuario de la sesión y el mail del token es `fedeguastadisegni@gmail.com`. El rol `anon` no tiene permisos sobre esas tablas.

También instala un trigger en `auth.users` que rechaza cualquier cuenta con otro mail (`Esta app es privada`). En el SQL Editor de Supabase ese trigger se puede crear. Si alguna vez fallara por permisos, las políticas igual no le muestran datos a nadie más: sin el mail permitido, las filas no se ven ni se escriben.

## Google

1. **Authentication → Sign In / Providers → Google**: activalo.
2. En **Authentication → URL Configuration**, la Site URL y Redirect URLs tienen que incluir `https://fedeguastadisegni.github.io/Simpla/` (con la barra final).

## Ver que RLS está activo

```sql
select c.relname as tabla,
       c.relrowsecurity as rls,
       c.relforcerowsecurity as forzado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by 1;
```

`cards`, `card_items`, `loans`, `services`, `service_bills`, `subscriptions` y `expenses` tienen que tener `rls` y `forzado` en true.

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by 1, 3;
```

Cada tabla tiene que tener select, insert, update y delete.

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public';
```

Eso tiene que venir vacío.

El SQL Editor entra como superusuario y el RLS no lo frena. Por eso esas consultas miran la configuración, no las filas. El aislamiento de verdad se nota entrando con Google desde la app, o con `set role authenticated` y el JWT de un usuario.
