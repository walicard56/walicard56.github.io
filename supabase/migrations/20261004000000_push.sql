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
