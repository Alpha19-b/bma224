# Djomi sync payments

Cette fonction verifie automatiquement les commandes BMA en attente de paiement, sans webhook Djomi dedie.

Elle :

1. lit les commandes `payment_status != 'paid'` avec `djomi_transaction_id`;
2. appelle Djomi `GET /v1/payments/{transactionId}/status`;
3. met `orders.payment_status = 'paid'` si Djomi confirme `SUCCESS` ou `CAPTURED`;
4. garde les commandes en attente si Djomi repond `PENDING`, `REDIRECTED`, `FAILED`, etc.

Elle peut etre appelee :

- automatiquement par l'administration quand elle est ouverte ;
- par une tache planifiee Supabase avec le header `x-bma-sync-secret`.

Secrets attendus :

```bash
supabase secrets set djomi_id="ton-client-id"
supabase secrets set djomi_key="ton-client-secret"
supabase secrets set BMA_SYNC_SECRET="une-longue-cle-aleatoire"
```

Optionnel :

```bash
supabase secrets set djomi_partner_domain_key="cle-domaine-djomi"
```

