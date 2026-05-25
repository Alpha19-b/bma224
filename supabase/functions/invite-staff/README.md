# invite-staff

Edge Function BMA pour inviter un manager ou un vendeur depuis l'administration.

Secrets attendus par Supabase :

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BMA_SITE_URL` optionnel, par defaut `https://bma224.com`

La fonction refuse toute demande si l'utilisateur connecte n'a pas le role `owner`
dans `public.admin_users`.
