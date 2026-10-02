-- Fôlego — banco de dados dos clientes (Supabase / Postgres)
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > colar > Run.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------
-- Perfil de cada cliente (criado automaticamente no 1º login)
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  full_name        text,
  avatar_url       text,
  trial_started_at timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Dados financeiros do app (um JSON por cliente, sincronizado)
-- ---------------------------------------------------------------
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now(),
  constraint user_data_tamanho check (octet_length(state::text) < 1000000)
);

-- ---------------------------------------------------------------
-- Assinaturas da Google Play (gravadas só pela função verify-purchase)
-- ---------------------------------------------------------------
create table if not exists public.subscriptions (
  purchase_token text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  product_id     text not null,
  status         text,
  expires_at     timestamptz not null,
  updated_at     timestamptz not null default now()
);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);

-- ---------------------------------------------------------------
-- Controle do teste grátis: guarda só o HASH do e-mail, e não é
-- apagado ao excluir a conta (impede ganhar outro teste grátis).
-- ---------------------------------------------------------------
create table if not exists public.trial_claims (
  email_hash text primary key,
  started_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Segurança (RLS): cada cliente só enxerga os próprios dados
-- ---------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.user_data     enable row level security;
alter table public.subscriptions enable row level security;
alter table public.trial_claims  enable row level security;

drop policy if exists "perfil: ler o próprio" on public.profiles;
create policy "perfil: ler o próprio" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "dados: ler os próprios" on public.user_data;
create policy "dados: ler os próprios" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "dados: criar os próprios" on public.user_data;
create policy "dados: criar os próprios" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "dados: alterar os próprios" on public.user_data;
create policy "dados: alterar os próprios" on public.user_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "dados: apagar os próprios" on public.user_data;
create policy "dados: apagar os próprios" on public.user_data
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "assinatura: ler a própria" on public.subscriptions;
create policy "assinatura: ler a própria" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.user_data, public.subscriptions, public.trial_claims from anon;
revoke all on public.trial_claims from authenticated;
revoke insert, update, delete on public.profiles, public.subscriptions from authenticated;
grant select on public.profiles, public.subscriptions to authenticated;
grant select, insert, update, delete on public.user_data to authenticated;

-- ---------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  h text := encode(extensions.digest(lower(coalesce(new.email, new.id::text)), 'sha256'), 'hex');
  started timestamptz;
begin
  insert into public.trial_claims(email_hash) values (h) on conflict (email_hash) do nothing;
  select started_at into started from public.trial_claims where email_hash = h;
  insert into public.profiles(id, email, full_name, avatar_url, trial_started_at)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
          coalesce(started, now()))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch before insert or update on public.user_data
  for each row execute function public.touch_updated_at();
