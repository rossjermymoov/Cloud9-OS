# Cloud9 OS — Deploy to GitHub + Railway

The project is already git-initialised with an initial commit. Run these on your Mac
(the Terminal, in the project folder). Cloud has set up the repo but can't push —
that needs your GitHub/Railway accounts.

> If git complains that `.git/index.lock` (or `HEAD.lock`) exists, that's a leftover
> from the sandbox — just delete it: `rm -f .git/*.lock .git/objects/*/tmp_obj_*`

## 1. Push to GitHub

**Option A — GitHub CLI (easiest):**
```bash
cd "~/Documents/Claude/Projects/Cloud9 OS"
gh repo create cloud9-os --private --source=. --remote=origin --push
```

**Option B — manual:** create an empty private repo named `cloud9-os` on github.com, then:
```bash
cd "~/Documents/Claude/Projects/Cloud9 OS"
git branch -M main
git remote add origin https://github.com/<your-username>/cloud9-os.git
git push -u origin main
```

## 2. Deploy on Railway

1. railway.app → **New Project → Deploy from GitHub repo** → pick `cloud9-os`.
2. Add a **PostgreSQL** database to the project (this sets `DATABASE_URL`). Migrations
   run automatically on first boot.
3. In the service **Variables**, set:
   - `NODE_ENV` = `production`
   - `CLOUD9_WEBHOOK_TOKEN` = a long random secret (you'll paste this into Helm)
   - `HELM_API_BASE` = `https://<your-subdomain>.myhelm.app/public-api`
   - `HELM_EMAIL`, `HELM_PASSWORD` (and `HELM_2FA_CODE` if used)
4. Railway builds via `railway.toml` and serves the React app from the API server.
   Note your public URL, e.g. `https://cloud9-os-production.up.railway.app`.

## 3. Point Helm at the webhooks

For each Helm event, set the URL to `https://<your-railway-domain>/api/v1/webhooks/<event>`
with header `Authorization: Bearer <CLOUD9_WEBHOOK_TOKEN>`:

`order-created`, `order-dispatched`, `order-updated`, `fulfilment-client-created`,
`purchase-order-created`, `purchase-order-updated`, `delivery-created`, `return-created`,
`shipment-created`, `tracking-update`, `inventory-created`, `pick-completed`,
`inbound-received`, `shipment-cancelled`.

## 4. First run + parser-locking

```
GET  https://<domain>/api/health                 # { status: ok }
POST https://<domain>/api/helm/sync/customers    # pull fulfilment clients
POST https://<domain>/api/helm/sync/volume?days=30
GET  https://<domain>/api/v1/webhooks/log        # inspect captured webhook payloads
```

Fire a few Helm webhooks, then send me the output of `/api/v1/webhooks/log` (or paste a
couple of captured payloads) and I'll lock the parsers — especially the fulfilment-client
id on orders, the parcel structure, and the delivery/return/pick shapes.
