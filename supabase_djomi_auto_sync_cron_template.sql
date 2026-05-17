-- BMA - synchronisation automatique Djomi sans webhook.
-- Optionnel mais recommande : execute ce template dans Supabase SQL Editor
-- apres avoir deploye la fonction djomi-sync-payments.
--
-- Remplace :
--   TON_PROJECT_REF par ton ref Supabase, ex: pnvefkemzetovibwclmf
--   TA_CLE_BMA_SYNC_SECRET par la meme valeur que le secret Edge Function BMA_SYNC_SECRET

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('bma-djomi-sync-every-minute')
where exists (
  select 1
  from cron.job
  where jobname = 'bma-djomi-sync-every-minute'
);

select cron.schedule(
  'bma-djomi-sync-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://TON_PROJECT_REF.supabase.co/functions/v1/djomi-sync-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bma-sync-secret', 'TA_CLE_BMA_SYNC_SECRET'
    ),
    body := jsonb_build_object('limit', 50)
  );
  $$
);
