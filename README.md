# BMA React

Site React/Vite pour la boutique client BMA et l'administration.

## Lancer en local

```bash
npm install
npm run dev
```

Ensuite :

- Boutique client : `http://127.0.0.1:5173/`
- Administration : `http://127.0.0.1:5173/admin`

## Mise en ligne GitHub Pages

Le dossier a envoyer sur GitHub est `boutique-react`.

Dans GitHub, active Pages avec :

- Source : `GitHub Actions`
- Domaine personnalise : `bma224.com`

Dans `Settings > Secrets and variables > Actions`, ajoute :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_SITE_URL`

`VITE_PUBLIC_SITE_URL` doit etre l'URL publique HTTPS exacte du site. Djomi refuse les liens `http://localhost`.

Exemple :

```bash
VITE_SUPABASE_URL=https://pnvefkemzetovibwclmf.supabase.co
VITE_PUBLIC_SITE_URL=https://bma224.com
```

La boutique reste disponible sur `/`. L'administration reste disponible sur `/admin`.

L'application detecte aussi un sous-domaine `admin.` si tu l'utilises plus tard.

## Supabase

La connexion locale utilise `.env.local` :

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_PUBLIC_SITE_URL=https://bma224.com
```

Les Edge Functions Djomi restent hebergees sur Supabase.
