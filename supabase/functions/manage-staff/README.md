# manage-staff

Edge Function BMA pour lister le personnel, changer un role et retirer un acces admin.

Actions supportees dans le body JSON :

- `{ "action": "list" }`
- `{ "action": "update_role", "user_id": "...", "role": "manager" }`
- `{ "action": "remove", "user_id": "..." }`

Seul un utilisateur avec le role `owner` dans `public.admin_users` peut l'utiliser.
