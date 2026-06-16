# Cloud9 OS — Development & Deployment Process Audit

**Date:** 16 June 2026
**Scope:** The end-to-end pipeline — prompt Claude → commit/push to GitHub → Railway auto-deploy → PostgreSQL (Railway). Covers source control, build/release, database, security, resilience and the AI-assisted development loop itself.
**Caveat:** This is an engineering-process audit based on the repository and infrastructure as configured. It is not legal advice. Items depending on documents I can't see (vendor contracts, Railway backup settings) are flagged as "confirm".

**RAG key:** 🟢 sound / 🟡 needs attention / 🔴 fix soon.

---

## 1. The pipeline, in one line

You prompt Claude → Claude writes code into the local project folder → you `git add/commit/push` to GitHub `main` → Railway auto-builds (nixpacks) and deploys → on boot the server auto-runs any new SQL migrations against the Railway Postgres → the app serves live.

It's a clean, fast, modern loop. The weaknesses are not in the *idea* of the loop — they're in the **absence of safety gates** between "code written" and "running in production in front of real customer data."

---

## 2. What you're doing well 🟢

- **Secrets are kept out of git.** `.gitignore` correctly excludes `.env`, `node_modules`, `dist`, logs and `.DS_Store`. A scan of tracked files shows only `.env.example` is committed — no real secrets in the repo. This is the single most important thing to get right, and you have.
- **`.env.example` is committed.** Config is documented without exposing values — good onboarding hygiene.
- **Declarative deployment.** `railway.toml` pins the build and start commands, so deploys are reproducible rather than hand-configured in a dashboard.
- **Security headers on.** `helmet` is enabled in Express.
- **Idempotent, tracked migrations.** The auto-runner records applied files in a `_migrations` table and handles dollar-quoted SQL blocks correctly — migrations won't double-apply.
- **Genuinely good documentation.** `README.md`, `DEPLOY.md` and a 17KB architecture document. Most solo projects have nothing like this.
- **Clear, atomic commit messages.** The history reads as a sensible changelog ("Voila API timeout + retries", "Count volume by despatch date"). Easy to audit and revert.
- **Sensible DB pool config** with connection/idle timeouts.

The foundation is better than most early-stage products. The gaps below are about *operational maturity*, not basic competence.

---

## 3. What needs attention

### Source control & release process

🔴 **You commit straight to `main`, and `main` is production.** There is no branch, no pull request, no review step and no staging environment. Every push goes live immediately. There is no point at which a change can be seen running before customers see it.

🔴 **No CI checks whatsoever.** There is no `.github/workflows` directory. Nothing runs a syntax check, linter or test before Railway deploys. A single bad push deploys a broken app to production — which **already happened today** (the server went down after a deploy and you only found out by manually curling it).

🔴 **No automated tests.** There are zero test files in the repo. Every change is verified by deploying it and poking the live endpoints. That works at this size but means every regression is found in production.

### Build & deployment

🟡 **Deploy verification is manual and reactive.** Your "did it work?" step is curling endpoints by hand. There's no health-check gate, no automatic rollback on a failed boot. Railway will happily keep a crash-looping deploy live.

🟡 **No uptime or error monitoring.** When the app crashed earlier, nothing alerted you. For a tool the operations team relies on each morning, you want to know it's down *before* the 9am meeting, not discover it live.

### Database

🔴 **Migrations auto-run against production on every boot, with no backup or rollback.** A new `.sql` file executes automatically the moment the deploy starts. There is no "migrate down", and I can see no evidence of a database backup before migration. A single bad migration (a wrong `ALTER`, a `DROP`) would hit live customer data with no safety net.

🔴 **Confirm Railway Postgres backups are enabled.** I can't see your Railway settings. If automated daily backups / point-in-time recovery are **not** switched on, your entire dataset is one mistake away from being unrecoverable. This is the highest-impact thing to verify today.

🟡 **TLS verification disabled on the DB connection.** `ssl: { rejectUnauthorized: false }` in production. Inside Railway's private network the practical risk is low, but it disables certificate checking and is worth tightening.

### Security & access

🔴 **The application API has no authentication.** Only the webhook endpoints check a token. Every data endpoint — customers, volume, the `/diagnose` and `/helm/raw/fulfilment-clients` debug routes — is reachable by anyone with the URL. This is both a security hole and a data-protection failure (see the separate GDPR notes). It is the most urgent fix.

🟡 **No rate limiting.** Public endpoints (and the bearer-token webhook) have no throttling, leaving them open to abuse and brute-force guessing of the webhook token.

🟡 **Password-based service auth + a static 2FA code in env.** Helm is authenticated with `HELM_EMAIL` / `HELM_PASSWORD` / `HELM_2FA_CODE`. A hard-coded 2FA value is fragile (TOTP codes rotate) and a stored password is weaker than a scoped API key. That password was also exposed in chat earlier and should be rotated.

🟡 **No dependency scanning.** No Dependabot, no `npm audit` in any pipeline. Vulnerable packages would go unnoticed.

### The AI-assisted development loop itself

🟡 **Single point of knowledge / bus factor of one.** The system is built entirely through you prompting Claude. There's no second engineer who understands it. If you're unavailable, no one can safely change it. The strong documentation mitigates this, but partially.

🟡 **Claude-written code goes to production largely unreviewed.** The model (me) is fast and usually correct, but not infallible — today's outage came from a deploy. Without a test/CI gate, you're trusting each generated change directly against live data. The fix isn't "stop using AI", it's "put the same guardrails around AI-written code that you'd put around any code."

---

## 4. Priority actions

Ordered by risk-reduction per unit of effort.

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 1 | **Confirm Railway Postgres automated backups are ON** (enable PITR if available) | One bad migration or deploy currently = potential total data loss | Minutes |
| 2 | **Put authentication in front of the app** | Live customer + end-consumer data is currently public | ~½ day |
| 3 | **Add a minimal CI check** (`.github/workflows`: `node --check` + `npm install` + build) before deploy | Stops broken pushes reaching production — would have caught today's outage | ~1 hour |
| 4 | **Take a manual DB backup immediately before any migration** until automated backup-before-migrate exists | Safety net for the auto-run migration risk | Minutes each |
| 5 | **Rotate the Helm password** and move to an API key/token if Helm supports one | It was exposed and is the weakest credential | ~30 min |
| 6 | **Add uptime + error monitoring** (a free uptime pinger on `/api/health`, and an error tracker like Sentry) | Know about outages before the team does | ~1 hour |
| 7 | **Introduce a `staging` environment / branch** so changes run somewhere real before `main` | Removes "every push is a live experiment" | ~½ day |
| 8 | **Add a data-retention job** to prune/strip raw payloads | Data-minimisation (see GDPR notes) | ~½ day |
| 9 | **Add rate limiting** (`express-rate-limit`) | Abuse / brute-force protection | ~30 min |
| 10 | **Tighten DB TLS** and add `npm audit` / Dependabot | Defence in depth | ~1 hour |

---

## 5. Bottom line

The **architecture and code quality are good**, and your **secret-handling and documentation are genuinely strong**. The risk isn't in how you build — it's in the **lack of guardrails between building and running in production**: no review gate, no tests, no CI, no staging, auto-migrations with no backup, and an open API. None of that has bitten you hard *yet* because the app is young and lightly used, but today's outage was a preview of exactly this gap.

If you do nothing else this week: **verify backups (#1), lock the app behind auth (#2), and add the one-hour CI check (#3).** Those three remove the worst of the "one mistake from disaster" exposure.
