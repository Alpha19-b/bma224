# Djomi confirm payment

Cette fonction confirme le retour Djomi et marque la commande Supabase comme payee, sans utiliser de webhook dedie.

Flux :

1. `djomi-checkout` genere une reference de paiement et un jeton HMAC signe.
2. `djomi-checkout` stocke le `transactionId` retourne par Djomi dans `orders.djomi_transaction_id`.
3. Djomi redirige le client vers `/payment-success` avec `order_id`, `transaction_ref`, `amount` et `token`.
4. Le frontend appelle `djomi-confirm-payment`.
5. La fonction verifie la signature, appelle `GET /v1/payments/{transactionId}/status`, verifie le montant, puis met `orders.payment_status = 'paid'`.

La meme fonction peut aussi etre appelee depuis "Mes achats" avec seulement `order_id` pour verifier a nouveau une commande en attente.

Secrets attendus :

```bash
supabase secrets set djomi_key="ton-client-secret"
```

La fonction utilise aussi les secrets Supabase automatiques :

```bash
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```
