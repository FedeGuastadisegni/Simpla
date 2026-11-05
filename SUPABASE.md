# Supabase

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
