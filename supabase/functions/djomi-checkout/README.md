# Djomi checkout

Cette fonction cree un paiement Djomi pour BMA.

Flux utilise :

1. Formater le telephone au format Djomi, exemple `00224622123456`.
2. Generer la signature HMAC-SHA256 avec `clientId` signe par `clientSecret`.
3. Appeler `https://api.djomy.africa/v1/auth`.
4. Appeler `https://api.djomy.africa/v1/payments/gateway`.
5. Retourner `payment_url` au frontend pour redirection.

Secrets Supabase attendus :

```bash
supabase secrets set djomi_id="ton-client-id"
supabase secrets set djomi_key="ton-client-secret"
```

Optionnel, si la cle domaine change :

```bash
supabase secrets set djomi_partner_domain_key="cle-domaine-djomi"
```

La fonction accepte aussi les noms alternatifs `DJOMI_CLIENT_ID`, `DJOMI_CLIENT_SECRET` et `DJOMI_PARTNER_DOMAIN_KEY`.
