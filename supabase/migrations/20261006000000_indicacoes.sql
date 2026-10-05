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
