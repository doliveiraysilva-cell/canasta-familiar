-- Canasta Familiar: base de datos. Pegar todo en Supabase > SQL Editor > Run.
-- Se puede correr más de una vez sin romper nada.

create table if not exists public.members (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['items','purchases','prices','promos','config'] loop
    execute format('create table if not exists public.%I (id text primary key, data jsonb not null default ''{}'', created_at timestamptz not null default now())', t);
  end loop;
end $$;

-- Quién es quién
create or replace function public.is_member() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from members where id = auth.uid()) $$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from config where id = 'owner' and data->>'id' = auth.uid()::text) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select public.is_owner() or exists (select 1 from config where id = 'admins' and data->'ids' ? auth.uid()::text) $$;

create or replace function public.family_exists() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from members) $$;
grant execute on function public.family_exists() to authenticated;

-- Unirse a la familia: el primero que entra es el dueño; los demás necesitan el código familiar
create or replace function public.join_family(p_code text, p_name text, p_role text, p_color text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); code text;
begin
  if uid is null then raise exception 'sin_sesion'; end if;
  if exists (select 1 from members where id = uid) then return 'ya_miembro'; end if;
  if not exists (select 1 from members) then
    insert into config (id, data) values ('owner', jsonb_build_object('id', uid::text))
      on conflict (id) do update set data = excluded.data;
    insert into config (id, data) values ('admins', jsonb_build_object('ids', jsonb_build_array(uid::text)))
      on conflict (id) do update set data = excluded.data;
    insert into config (id, data) values ('join', jsonb_build_object('code', upper(substr(md5(random()::text), 1, 6))))
      on conflict (id) do nothing;
  else
    select data->>'code' into code from config where id = 'join';
    if code is null or upper(trim(coalesce(p_code, ''))) <> code then raise exception 'codigo_invalido'; end if;
  end if;
  insert into members (id, data) values (uid, jsonb_build_object(
    'name', left(coalesce(p_name, ''), 30), 'role', left(coalesce(p_role, ''), 20), 'color', left(coalesce(p_color, ''), 9),
    'at', (extract(epoch from now()) * 1000)::bigint));
  return 'ok';
end $$;
revoke all on function public.join_family(text, text, text, text) from public, anon;
grant execute on function public.join_family(text, text, text, text) to authenticated;
grant execute on function public.is_member() to authenticated;

-- Acceso desde la app (la seguridad la ponen las reglas de abajo)
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members, public.items, public.purchases, public.prices, public.promos, public.config to authenticated;

-- Seguridad por fila
alter table public.members enable row level security;
alter table public.items enable row level security;
alter table public.purchases enable row level security;
alter table public.prices enable row level security;
alter table public.promos enable row level security;
alter table public.config enable row level security;

drop policy if exists m_read on public.members;   create policy m_read on public.members for select to authenticated using (public.is_member());
drop policy if exists m_self on public.members;   create policy m_self on public.members for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists m_owner on public.members;  create policy m_owner on public.members for delete to authenticated using (public.is_owner());

do $$ declare t text; begin
  foreach t in array array['items','purchases','prices'] loop
    execute format('drop policy if exists fam_all on public.%I', t);
    execute format('create policy fam_all on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

drop policy if exists p_read on public.promos;  create policy p_read on public.promos for select to authenticated using (public.is_member());
drop policy if exists p_write on public.promos; create policy p_write on public.promos for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists c_read on public.config;  create policy c_read on public.config for select to authenticated using (public.is_member());
drop policy if exists c_write on public.config; create policy c_write on public.config for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Cambios en vivo
do $$ declare t text; begin
  foreach t in array array['members','items','purchases','prices','promos','config'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Fotos de los tickets (privadas, solo la familia)
insert into storage.buckets (id, name, public) values ('tickets', 'tickets', false) on conflict (id) do nothing;
drop policy if exists tickets_fam on storage.objects;
create policy tickets_fam on storage.objects for all to authenticated
  using (bucket_id = 'tickets' and public.is_member()) with check (bucket_id = 'tickets' and public.is_member());
