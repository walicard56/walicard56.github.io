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
