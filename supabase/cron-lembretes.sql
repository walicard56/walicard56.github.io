-- Fôlego — agenda o envio diário dos lembretes (rode no SQL Editor DEPOIS de
-- publicar a função send-reminders). Troque os dois valores entre <>.
--   <PROJECT_REF>   código do projeto (https://<PROJECT_REF>.supabase.co)
--   <CRON_SECRET>   o mesmo valor do secret CRON_SECRET da função
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('folego-lembretes') where exists (select 1 from cron.job where jobname = 'folego-lembretes');

-- Todos os dias às 09:00 de Brasília (12:00 UTC).
select cron.schedule('folego-lembretes', '0 12 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);
