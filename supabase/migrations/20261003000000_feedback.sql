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
