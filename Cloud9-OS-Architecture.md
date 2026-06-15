# Cloud9 Operating System — Architecture & Build Plan

**Status:** Draft v0.1 for review
**Author:** Ross + Claude
**Date:** 15 June 2026

---

## 1. What Cloud9 is

Cloud9 OS is an operations layer that wraps a **Helm** warehouse management system (WMS) and **Xero** billing into a single "air traffic control" view for a 3PL business. It pulls the customer list and operational data out of Helm via API, pulls billing/financial data out of Xero, and gives the team one place to:

- manage customers (copied from Moov OS),
- run and resolve queries/claims (copied from Moov OS),
- watch daily shipment and item volumes per customer,
- track parcels in flight and get alerted to problems,
- get alerted the moment a purchase order is raised in Helm.

It reuses the proven Moov OS codebase wherever the behaviour is identical, and swaps the data source from Voila to Helm.

> **RAG key used throughout this doc** — 🟢 Green = proven / copy as-is, 🟡 Amber = copy but needs adaptation, 🔴 Red = net-new build.

---

## 2. What we reuse from Moov OS

Moov OS already contains almost every building block Cloud9 needs. The table below is the reuse plan.

| Area | Moov OS source | Reuse | Notes |
|---|---|---|---|
| Customer section | `server/routes/customers.js`, `client/src/pages/customers/*`, migration `001` | 🟢 Green | Copy wholesale. Full CRUD, contacts, communications, volume snapshots, health score, on-stop, AI onboarding. |
| Query / claims system | `server/routes/queries.js`, `client/src/pages/queries/*`, `services/slaEngine.js`, `triageEngine.js` | 🟢 Green | Copy wholesale. Inbox, AI triage, SLA engine, claim-deadline tracking, email drafts. |
| App shell / routing / auth | `client/src/App.jsx`, `components/layout/*`, `context/AuthContext.jsx`, `routes/auth.js` | 🟢 Green | Copy. Rename branding Moov → Cloud9. |
| Design tokens (RAG colours) | `client/src/design/tokens.js` | 🟢 Green | Already green/amber/red health model — matches your convention exactly. |
| Tracking page (UI + pop-ups) | `client/src/pages/tracking/TrackingPage.jsx` | 🟢 Green | Copy **exactly** — same layout, same pop-ups/modals. Proven and looks good; no redesign. |
| Tracking + status engine | `server/routes/tracking.js` (status normalisation, event ingest) | 🟢 Green | Copy the ingest + status-mapping logic as-is. Only the webhook *source* differs (different sending location/credentials), not the code. |
| Webhook framework | `server/routes/webhooks.js` | 🟡 Amber | Same pattern (fast 200, background processing, idempotency gate). New event types for Helm + purchase orders. |
| Integration client | `server/services/voilaClient.js` | 🟡 Amber | Template for a new `helmClient.js` — same shape, different auth + endpoints. |
| Xero billing | `server/routes/xero.js`, migration `097_xero_tokens` | 🟡 Amber | OAuth + token storage already built. Map Cloud9 customers → Xero contacts. |
| Air-traffic-control dashboard | — | 🔴 Red | Net-new. Daily shipments, items per customer, live status board. |
| Helm customer sync | — | 🔴 Red | Net-new. Pull customer list from Helm API. |
| Items / inventory view | — | 🔴 Red | Net-new. Items-per-customer needs Helm's item/order data. |
| Purchase-order alerts | — | 🔴 Red | Net-new. New webhook + alert rule. |

The headline: roughly two-thirds of Cloud9 is a copy-and-rebrand job, and the new work concentrates on the **Helm integration** and the **air traffic control dashboard**.

---

## 3. Tech stack

Identical to Moov OS so the copied modules drop straight in:

- **Front end:** React 18, Vite, Tailwind, React Router, TanStack Query, axios, lucide-react.
- **Back end:** Node + Express (ESM), PostgreSQL via `pg`, JWT auth, helmet/cors/morgan.
- **Integrations:** Helm API (new client), Xero (OAuth), SendGrid (alert emails), optionally Gmail (query inbox) and an AI provider for triage/health scoring.
- **Hosting:** Railway (nixpacks), same as Moov OS. Server serves the built React app in production.

---

## 4. High-level architecture

```
                  ┌─────────────────────────────────────────────┐
   Helm WMS  ───► │  Webhooks: PO created, shipment created,     │
   (API +         │  tracking update, inbound/GRN received       │
    webhooks)     └───────────────┬─────────────────────────────┘
                                  │  (fast 200, background processing)
   Helm API   ◄──── helmClient ───┤
   (pull:                         ▼
    customers,            ┌──────────────────┐      ┌──────────────┐
    items, orders)        │  Cloud9 server   │◄────►│  PostgreSQL  │
                          │  (Express)       │      └──────────────┘
   Xero API   ◄──── xero ─┤                  │
   (billing)              └────────┬─────────┘
                                   │ REST /api/*
                          ┌────────▼─────────┐
                          │  Cloud9 web app  │  ◄── Air traffic control,
                          │  (React)         │      customers, queries,
                          └──────────────────┘      tracking, alerts
```

Two data paths, exactly as Moov OS does it with Voila:

1. **Push (webhooks)** — Helm calls Cloud9 the instant something happens (PO raised, shipment created, tracking scan). Cloud9 returns `200` immediately and processes in the background so Helm never retries.
2. **Pull (API)** — Cloud9 calls Helm to fetch the customer list, item/order detail, and to backfill anything a missed webhook would have left behind. This mirrors Moov OS's Voila backfill safety net.

---

## 5. Webhook endpoints (what to wire up in Helm)

You said you can configure Helm webhooks if I give you endpoints. Here is the proposed contract. All follow the Moov OS convention: a single shared bearer token, immediate `200`, background processing.

**Base URL (once deployed):** `https://<cloud9-host>/api/v1/webhooks`
**Auth header on every call:** `Authorization: Bearer <CLOUD9_WEBHOOK_TOKEN>` (we generate this secret and you paste it into Helm).

| Event | Endpoint | Fires when | Drives |
|---|---|---|---|
| Order created | `POST /order-created` | An outbound order is created in Helm | Orders table, dispatch volume |
| Order updated | `POST /order-updated` | An order changes (incl. despatch) | **Real parcel + item counts** → daily volume |
| Purchase order created | `POST /purchase-order-created` | A PO is raised in Helm | 🔔 PO-created alert |
| Tracking update | `POST /tracking-update` | A carrier scan / status change | Live tracking board, issue alerts |
| Shipment created | `POST /shipment-created` | An outbound shipment/label is created | Shipment records |
| Inbound / GRN received | `POST /inbound-received` | Stock booked in against a PO | Closes the loop on the PO |
| Shipment cancelled | `POST /shipment-cancelled` | A shipment is voided | Marks shipment cancelled |

**Parcels per order:** an order can have many parcels, so volume is counted from the **real parcel data** on the order/tracking webhooks (the `orders` table is the source of truth), never assumed as one-per-order. The Helm pull sync is a backfill that the webhooks correct.

For each one I'll publish the exact JSON payload shape we expect once I've seen the Helm API docs — then you map Helm's fields to it (or we adapt our parser to Helm's native shape, which is what we did for Voila). **To finalise these I need the Helm API documentation**, especially the PO and tracking webhook payloads.

---

## 5b. Configuration deltas vs Moov OS

Cloud9 reuses the Moov OS code but points at different accounts. These are environment/credential changes only — no code rewrite:

| Thing | Moov OS | Cloud9 | Change type |
|---|---|---|---|
| Tracking webhook source | Voila | Different location (you'll send from elsewhere) | Config — new sender + token |
| Xero account | Moov's Xero | Cloud9's own Xero org | Config — new OAuth connection |
| Service inbox (queries) | Moov support Gmail | Cloud9's own **Gmail** account | Config — new Gmail OAuth credentials |
| Tracking page & pop-ups | — | **Identical copy** | No change — copied as-is |

Everything above is wired through env vars / settings, so swapping accounts is a setup step, not a build step.

---

## 6. Core modules

### 6.1 Customers 🟢
Direct copy from Moov OS Section 1. Customer list with search/filter/sort, full record with contacts, communications timeline, volume snapshots, health score (green/amber/red), credit utilisation, on-stop workflow with audit log, and AI-assisted onboarding from an application form PDF. The one change: customer records are seeded/synced **from Helm** rather than entered manually (see 6.3).

### 6.2 Queries & claims 🟢
Direct copy. Inbox with priority triage, SLA engine, claim-deadline countdown (RAG-coded by days remaining), AI-drafted replies awaiting human approval, courier communication. Works the same way it does today; only the customer/shipment references point at Cloud9 data.

### 6.3 Helm integration 🟢 (customers) / 🟡 (items)
`helmClient.js` built against the real Helm 3.6 public API (`https://{company}.myhelm.app/public-api`). Auth is `POST /auth/login {email,password,2fa_code}` → bearer token (cached, auto-refreshed on 401).

**Key modelling decision:** a Cloud9 customer = a Helm **`fulfilment_client`** (`GET /fulfilment_clients`) — the businesses Ross fulfils for and bills, carrying `billing_email` and `accounts_id` (the accounting/Xero link). Helm's own `/customers` endpoint returns end-consumer shipping contacts and is **not** used for the customer section.

- **Customer sync** 🟢 — `POST /api/helm/sync/customers` pulls all fulfilment clients (paginated) and upserts into `customers`, matched on `helm_customer_id`. Stores `helm_accounts_id` for Xero linking.
- **Dispatch volume** 🟢 — `POST /api/helm/sync/volume?days=N` pulls despatched orders (filtered by `dispatched_date_range` + `fulfilment_clients`), counting parcels (per shipment, default 1/order) and items (`total_inventory_quantity`) per day, upserted into `customer_volume_snapshots`. Surfaced on the dashboard (parcels/items today, 14-day trend, by-customer) and each customer record via `/api/volume/*`.
- **Note on webhooks** — the Helm public API is pull-only; there's no webhook-subscription endpoint in the collection. Helm fires webhooks from its own settings, so our receiver endpoints (section 5) stand ready but their exact payload shapes must be validated against a real Helm fire.

### 6.4 Xero billing 🟡
OAuth flow and token storage already exist in Moov OS. Work is: map each Cloud9 customer to a Xero contact, pull invoice/balance data onto the customer record (outstanding balance, credit utilisation already modelled), and feed billing status into the health score.

### 6.5 Air traffic control dashboard 🔴
The new centrepiece. A live operational board showing:
- **Daily shipments** — total and per customer, with trend vs the 13-week rolling average (the snapshot/average machinery already exists in the customer module).
- **Items per customer** — volume of items shipped, sourced from Helm order data.
- **Live status board** — parcels by status (booked → collected → in transit → out for delivery → delivered / exception), using the existing status normalisation engine, RAG-coded so exceptions and failures jump out in red.
- **Alert feed** — PO-created, tracking issues, volume drops, SLA breaches, all in one stream.

### 6.55 Notification Center 🔴
New module, not in Moov OS. A central feed of **customer-initiated events** flowing in from Helm webhooks — the first being "customer booked stock in" (a purchase order created). Each notification:

- appears in the **central Notification Center** ("Oriental Mart just raised a PO for 12 lines"), filterable by customer, type, and read/unread;
- **also threads onto the relevant customer record**, so opening a customer shows their recent activity in context;
- is RAG-coded by importance and can optionally raise an alert (e.g. PO over a value threshold).

Data: a `notifications` table (type, customer_id, title, body, payload JSON, read_at, severity, source_event). API: `GET /api/notifications` (feed + filters), `GET /api/customers/:id/notifications` (per-customer), `POST /api/notifications/:id/read`. The webhook handlers (PO created, stock booked, etc.) write into this table as their side-effect. This is the "extra bits" layer on top of the Moov OS base.

### 6.6 Tracking & alerting 🟢 / 🔴
Tracking page, pop-ups, event ingest and status normalisation are copied **exactly** from Moov OS (🟢) — only the webhook source changes. The alert framework (🔴) is extended with new rules:
- 🔔 **PO created** (net-new) — fire on the purchase-order webhook.
- 🔴 **Tracking exceptions** — failed delivery, customs hold, returned, stuck-in-transit beyond a threshold.
- 🟡 **Volume drop** — customer's daily volume falls below their rolling average (logic already exists).
- 🔴 **Webhook gap** — no events received during business hours (health monitor already exists in Moov OS).

Alerts surface in-app on the dashboard feed and can also email via SendGrid, with per-alert recipient lists and cooldowns (the Moov OS alert settings model supports this already).

---

## 7. Data model (starting point)

Reuse the Moov OS schema as the base. Key tables we carry over: `customers`, `customer_contacts`, `customer_communications`, `customer_volume_snapshots`, `customer_volume_alerts`, `customer_health_score_log`, `customer_on_stop_log`, `staff`, `queries`, `query_emails`, `query_evidence`, `shipments`, `tracking_events`, `xero_tokens`.

New tables for Cloud9:
- `purchase_orders` — PO header + lines received from Helm, status (open → partially received → received), linked to customer.
- `items` (or `order_items`) — per-shipment / per-order item detail to power items-per-customer.
- `helm_sync_log` — track customer/item sync runs for the backfill safety net.

Account numbers will use a `CLD-00001` style sequence (Moov uses `MOS-`/`MOOV-`), unless you'd rather mirror Helm's own customer IDs.

---

## 8. Phased delivery plan

**Phase 0 — Scaffold** 🟢 **DONE**
Cloud9 repo stood up and building green: React/Node/Postgres structure, core schema (customers, tracking, purchase orders, notifications), the tracking page copied exactly, customers list + record, the Notification Center, and all five webhook endpoints live. Helm client and Xero are stubbed/pending. See `README.md` for run instructions and current status.

**Phase 1 — Helm customer sync** 🔴
Build `helmClient.js`, pull the customer list, populate the customer section. This is the first thing that proves the Helm connection works.

**Phase 2 — Webhooks live** 🔴
Stand up the five webhook endpoints, starting with `purchase-order-created` (your priority alert) and `shipment-created`. You wire them into Helm; we verify with a probe endpoint like Moov OS's `voila-probe`.

**Phase 3 — Air traffic control dashboard** 🔴
Daily shipments, items per customer, live status board, alert feed.

**Phase 4 — Tracking alerts + Xero billing** 🟡
Tracking exception rules, volume-drop alerts, Xero contact mapping and invoice data on the customer record.

**Phase 5 — Queries/claims + AI** 🟢
Bring the full query system online once there's live shipment/customer data for it to reference.

---

## 9. What I need from you to proceed

1. ~~Helm API documentation~~ ✅ Received — Helm client + customer sync built. **Now need:** your Helm subdomain to confirm `HELM_API_BASE` (assumed `saas-ecommerce.myhelm.app`), and a real Helm webhook fire to validate the PO/tracking payload shapes.
2. **Confirmation on the scaffold** — happy for me to copy the Moov OS stack and rebrand as Phase 0?
3. **Account-number style** — `CLD-00001` sequence, or mirror Helm's customer IDs?
4. **Xero scope** — is Xero in scope for the first build, or a later phase? (I've put it in Phase 4.)
5. **Hosting** — Railway like Moov OS, or somewhere else?

---

## 10. Open questions / risks

- **Helm webhook reliability** — we'll mirror Moov OS's idempotency + backfill design so a missed or duplicated webhook never corrupts data. Low risk given the pattern is proven.
- **"Items per customer" depends on Helm's data model** — if Helm exposes order lines/SKUs cleanly this is straightforward; if not, we may need a nightly pull. Confirmed once I see the docs.
- **Auth/SSO** — Moov OS has its own JWT login. Fine to start there; flag if you need Helm or Google SSO instead.

---

*Next step on approval: Phase 0 scaffold.*
