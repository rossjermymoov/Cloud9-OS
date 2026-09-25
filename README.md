# Warehouse OS (3PL Operations Suite)

A standalone, white-labelable operations platform for 3PL warehouses that wraps **Helm WMS**, scales integration, courier tracking, and inventory interrogation into a single command centre.

---

## Quickstart Guide for New Warehouses

### Option A: 1-Command Docker Setup (Recommended)
Make sure you have [Docker Desktop](https://www.docker.com/) installed, then run:

```bash
docker compose up -d
```
Open **`http://localhost:5000`** in your browser to start the **3-step Onboarding Wizard**:
1. Enter your warehouse / app display name (e.g. *Apex Fulfilment OS*).
2. Enter your Helm WMS API URL and login credentials.
3. Create your initial admin login.

---

### Option B: Local Node.js Setup

1. **Install dependencies**:
   ```bash
   npm run install:all
   ```
2. **Configure environment**:
   ```bash
   cp .env.example server/.env
   # Edit server/.env to set your PostgreSQL connection string
   ```
3. **Start in development mode**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to complete setup.

---

## Features
- **White-Labeling**: Customize brand name, top-left logo, and accent colour dynamically.
- **Helm WMS Integration**: Live sync for fulfilment clients, purchase orders, inventory schemas, and dispatch volume.
- **Weigh & Measure Station**: Direct USB scale integration (My Weigh UltraShip U2) with hands-free auto-sync to Helm.
- **Inventory Interrogator**: Data quality sweeps with rate-limit backoff and exportable CSV reports.
- **Warehouse TV Board**: Real-time dispatch and productivity board for floor screens (`/warehouse`).


## Webhook endpoints (point Helm here)
All require header `Authorization: Bearer <CLOUD9_WEBHOOK_TOKEN>`.

All Helm webhook events have an endpoint (each returns 200 and is captured to `webhook_log`):

| Helm event | Endpoint | Handling |
|---|---|---|
| Order created | `/api/v1/webhooks/order-created` | orders table |
| Order dispatched | `/api/v1/webhooks/order-dispatched` | dispatch volume (real parcels) |
| Order updated | `/api/v1/webhooks/order-updated` | orders table + volume |
| Fulfilment client created | `/api/v1/webhooks/fulfilment-client-created` | upserts customer + onboarding alert |
| Purchase order created | `/api/v1/webhooks/purchase-order-created` | PO + alert |
| Purchase order updated | `/api/v1/webhooks/purchase-order-updated` | PO status/lines + alert |
| Delivery created | `/api/v1/webhooks/delivery-created` | alert (mapping TBC vs real fire) |
| Return created | `/api/v1/webhooks/return-created` | alert |
| Shipment created | `/api/v1/webhooks/shipment-created` | shipment record |
| Tracking update | `/api/v1/webhooks/tracking-update` | live tracking + exception alerts |
| Inventory created | `/api/v1/webhooks/inventory-created` | capture-only |
| Pick completed | `/api/v1/webhooks/pick-completed` | capture-only |
| Inbound received (GRN) | `/api/v1/webhooks/inbound-received` | goods-in vs PO |
| Shipment cancelled | `/api/v1/webhooks/shipment-cancelled` | marks cancelled |

Order webhooks feed the `orders` table (source of truth for dispatch volume) and recompute daily parcels/items per customer using the **real parcel count** on the order — orders can have many parcels.

Every inbound webhook's raw body is captured to `webhook_log`; inspect recent ones at `GET /api/v1/webhooks/log?endpoint=order-created` to see Helm's real payload shapes and lock the parsers.

## Going live for webhooks (to validate against real Helm fires)
The webhook endpoints need a public URL for Helm to reach. The project is Railway-ready:
1. Push this folder to a Git repo and create a Railway project from it.
2. Add a **PostgreSQL** plugin (sets `DATABASE_URL`); migrations run automatically on boot.
3. Set env vars: `CLOUD9_WEBHOOK_TOKEN` (a long random secret), `HELM_API_BASE`, `HELM_EMAIL`, `HELM_PASSWORD`, `NODE_ENV=production`.
4. Point Helm's webhooks at `https://<your-railway-domain>/api/v1/webhooks/<event>` with header `Authorization: Bearer <CLOUD9_WEBHOOK_TOKEN>`.
5. Fire a few events, then read `GET /api/v1/webhooks/log` to confirm shapes.

Proposed payload shapes are documented inline in `server/routes/webhooks.js` and will be finalised against the real Helm payloads.

## Helm customer sync
A Cloud9 customer maps to a Helm **fulfilment_client** (the businesses you fulfil for and bill — they carry `billing_email` + `accounts_id`). Helm's own `/customers` endpoint is end-consumer contacts and is not used for this.

To run a sync (after filling `HELM_*` in `server/.env`):
```
GET  /api/helm/status              # confirms auth works
POST /api/helm/sync/customers      # pulls fulfilment clients → customers table
POST /api/helm/sync/volume?days=30 # pulls despatched orders → parcels + items per customer per day
```
Dispatch volume (parcels/day, items/day, per customer) is read via `/api/volume/{summary,daily,by-customer}` and shown on the dashboard and each customer record. Run the customer sync before the volume sync.

## Next
1. Confirm your Helm subdomain for `HELM_API_BASE` and run the first customer sync.
2. Validate the webhook payload shapes against a real Helm webhook fire → lock contracts.
3. Wire Helm items/orders into the volume metrics + air traffic control dashboard.
4. Bring across Xero (via `accounts_id`) + the Moov OS queries module.
