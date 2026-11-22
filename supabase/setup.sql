-- Einrichtung für Hufschmied-Rechnungen
-- In Supabase: SQL Editor → New query → alles einfügen → Run.
-- Der Server speichert nur verschlüsselte Daten. Jeder Benutzer sieht ausschließlich seine eigenen Zeilen.

-- 1. Datensätze (Kunden, Pferde, Leistungen, Rechnungen, Einstellungen, Protokoll – alles verschlüsselt)
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store      text        not null,
  id         text        not null,
  deleted    boolean     not null default false,
  data       text,
  iv         text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, store, id)
);
create index if not exists records_user_updated on public.records (user_id, updated_at);

create or replace function public.records_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

alter table public.records enable row level security;
drop policy if exists "eigene Datensaetze" on public.records;
create policy "eigene Datensaetze" on public.records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 2. Rechnungsnummern-Zähler (damit PC und iPhone nie dieselbe Nummer vergeben)
create table if not exists public.counters (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  year    int  not null,
  value   int  not null,
  primary key (user_id, year)
);
alter table public.counters enable row level security;
drop policy if exists "eigene Zaehler" on public.counters;
create policy "eigene Zaehler" on public.counters
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.next_invoice_number(p_year int, p_floor int)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v int;
begin
  insert into public.counters (user_id, year, value)
  values (auth.uid(), p_year, greatest(p_floor, 0) + 1)
  on conflict (user_id, year)
  do update set value = greatest(public.counters.value, excluded.value - 1) + 1
  returning value into v;
  return v;
end $$;
revoke all on function public.next_invoice_number(int, int) from public, anon;
grant execute on function public.next_invoice_number(int, int) to authenticated;

-- 3. Dateispeicher für die (verschlüsselten) Rechnungs-PDFs
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists "eigene Dateien lesen" on storage.objects;
drop policy if exists "eigene Dateien anlegen" on storage.objects;
drop policy if exists "eigene Dateien aendern" on storage.objects;
create policy "eigene Dateien lesen" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "eigene Dateien anlegen" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "eigene Dateien aendern" on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
