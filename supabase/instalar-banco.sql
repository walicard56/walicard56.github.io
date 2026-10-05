-- Fôlego — instalação completa do banco (todas as migrações em ordem).
-- Supabase > SQL Editor > New query > cole TUDO > Run. Pode rodar de novo sem problema.

-- ============================================================
-- 20261002000000_folego_init.sql
-- ============================================================
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

-- ============================================================
-- 20261003000000_feedback.sql
-- ============================================================
-- Fôlego — feedback enviado pelo app ("Mais ou menos" no pedido de avaliação).
create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  message    text not null check (char_length(message) between 1 and 2000),
  context    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;

-- Qualquer pessoa (logada ou não) pode ENVIAR; ninguém lê pelo app.
drop policy if exists "feedback: enviar" on public.feedback;
create policy "feedback: enviar" on public.feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

revoke all on public.feedback from anon, authenticated;
grant insert (user_id, message, context) on public.feedback to anon, authenticated;

-- ============================================================
-- 20261004000000_push.sql
-- ============================================================
-- Fôlego — inscrições de notificações (lembretes de contas a pagar).
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  tz         text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push: ver as próprias" on public.push_subscriptions;
create policy "push: ver as próprias" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "push: criar as próprias" on public.push_subscriptions;
create policy "push: criar as próprias" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "push: alterar as próprias" on public.push_subscriptions;
create policy "push: alterar as próprias" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "push: apagar as próprias" on public.push_subscriptions;
create policy "push: apagar as próprias" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ============================================================
-- 20261005000000_lumi.sql
-- ============================================================
-- Fôlego — contador de perguntas à Lumi (limite diário por usuário).
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

drop policy if exists "ia: ver o próprio uso" on public.ai_usage;
create policy "ia: ver o próprio uso" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.ai_usage from anon;
revoke insert, update, delete on public.ai_usage from authenticated;
grant select on public.ai_usage to authenticated;

-- Incrementa e devolve o total do dia, de forma atômica (usado só pela função lumi).
create or replace function public.ai_usage_bump(p_user uuid, p_day date)
returns int language sql security definer set search_path = '' as $$
  insert into public.ai_usage(user_id, day, count) values (p_user, p_day, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count;
$$;
revoke all on function public.ai_usage_bump(uuid, date) from public, anon, authenticated;
grant execute on function public.ai_usage_bump(uuid, date) to service_role;

-- ============================================================
-- 20261006000000_indicacoes.sql
-- ============================================================
-- Fôlego — "Indique e ganhe": cada indicação válida dá +7 dias de Premium
-- para quem indicou e para quem chegou. As regras ficam aqui no banco.
alter table public.profiles add column if not exists ref_code    text unique;
alter table public.profiles add column if not exists bonus_days  int  not null default 0;
alter table public.profiles add column if not exists referred_by uuid references auth.users(id) on delete set null;

create table if not exists public.referrals (
  referred_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id);
alter table public.referrals enable row level security;
drop policy if exists "indicações: ver as minhas" on public.referrals;
create policy "indicações: ver as minhas" on public.referrals
  for select to authenticated using ((select auth.uid()) = referrer_id);
revoke all on public.referrals from anon;
revoke insert, update, delete on public.referrals from authenticated;
grant select on public.referrals to authenticated;

-- Código de convite do usuário logado (cria na primeira vez).
create or replace function public.my_ref_code()
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); code text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select ref_code into code from public.profiles where id = uid;
  if code is not null then return code; end if;
  loop
    code := upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1Il', ''), 1, 6));
    begin
      update public.profiles set ref_code = code where id = uid and ref_code is null;
      exit;
    exception when unique_violation then -- tenta outro código
    end;
  end loop;
  select ref_code into code from public.profiles where id = uid;
  return code;
end $$;

-- Usa um código de convite. Regras: só contas novas (teste começou há menos de 3 dias),
-- uma vez por conta, não vale o próprio código, e quem indica ganha no máximo 12 vezes (84 dias).
create or replace function public.claim_referral(p_code text)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me public.profiles; owner public.profiles; total int;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  select * into me from public.profiles where id = uid for update;
  if not found then return json_build_object('ok', false, 'reason', 'no_profile'); end if;
  if me.referred_by is not null then return json_build_object('ok', false, 'reason', 'already_claimed'); end if;
  if me.trial_started_at < now() - interval '3 days' then return json_build_object('ok', false, 'reason', 'too_late'); end if;
  select * into owner from public.profiles where ref_code = upper(trim(p_code));
  if not found then return json_build_object('ok', false, 'reason', 'invalid_code'); end if;
  if owner.id = uid then return json_build_object('ok', false, 'reason', 'own_code'); end if;

  update public.profiles set referred_by = owner.id, bonus_days = bonus_days + 7 where id = uid;
  insert into public.referrals(referred_id, referrer_id) values (uid, owner.id);
  select count(*) into total from public.referrals where referrer_id = owner.id;
  if total <= 12 then update public.profiles set bonus_days = bonus_days + 7 where id = owner.id; end if;
  return json_build_object('ok', true, 'bonus_days', 7);
end $$;

revoke all on function public.my_ref_code() from public, anon;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.my_ref_code() to authenticated;
grant execute on function public.claim_referral(text) to authenticated;
