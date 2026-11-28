# ADR 0007: Hosting, deployment and backups

Status: proposed (2026-11-28, #56). The deployment design is built and
tested. The hosting provider is the owner's decision; this record
recommends one.

## Context

The shop is about to move from local test mode to the internet. It needs:

- the Next.js server;
- the background worker running all the time (#53): without it, emails
  stay queued and unpaid card orders hold stock;
- PostgreSQL 17 with `pg_trgm`;
- HTTPS and outgoing email;
- daily backups that are proven to restore;
- a staging copy to try releases on.

The other constraints:

- **Customers are in Bulgaria and the data is personal**, so it stays in
  the EU (GDPR).
- **Traffic starts small:** a new shop with a few products.
- **Running costs should match that.**
- **The owner is not a system administrator**, so whatever we run must be
  scripted and documented, with nothing done by hand from memory.

## Decision

### Containers, the same on every host

`Dockerfile` builds two images from one commit:

- **web**: the standalone Next.js server, about 320 MB, running as a
  non-root user, with a health check on `/api/health?probe=live`.
- **tasks**: about 620 MB. It holds the migrations, the worker, the backup
  scripts, `pg_dump`/`pg_restore` 17 and rclone.

Configuration comes only from the environment at run time, and the build
bakes in nothing secret. All pages are rendered per request because of
the nonce CSP, so a build doesn't depend on the catalog source.

CI (`Container images`) builds both images on every pull request and runs
`scripts/image-smoke.sh` against a throwaway PostgreSQL:

- migrations run twice, then the demo catalog loads;
- pages, assets, image optimisation, security headers and probes;
- every worker job runs once;
- backups are taken while other sessions write;
- restore checks pass, and tampered dumps, damaged dumps and wrong row
  counts are rejected;
- a real restore refuses while a session is connected;
- the off-site copy refuses an unencrypted remote;
- the daily schedule runs, and its failure alert fires.

On every merge to `main` the tested images are published to GHCR as
`ghcr.io/<owner>/<repo>-web|tasks:sha-<commit>`.

### One server with Docker Compose, staging next to production

`deploy/compose.yaml` runs `db`, `web`, `worker` and `backup`. Each
environment is its own checkout with its own settings files, its own
containers and volumes (`auto-shop-production`, `auto-shop-staging`) and
its own port on 127.0.0.1.

One Caddy (`deploy/proxy`) terminates HTTPS for both environments, using
Let's Encrypt certificates that it renews itself. It puts staging behind a
password, except the Stripe webhook, which the shop verifies by signature.
Caddy replaces any `X-Forwarded-For` header a visitor sends, so the
per-client rate limits see the real address.

The Deploy workflow is started by hand and runs on the server through
a restricted SSH key: a forced command that accepts only
`<environment> <commit>`. It calls `deploy/deploy.sh`, which:

1. checks out the commit (production accepts only commits on `main`);
2. pulls that commit's images;
3. backs up the database;
4. applies the migrations;
5. starts the new version and waits for its health check.

If anything fails before the last step, the old version keeps running
and the checkout returns to it.

Migrations run while the old version still serves, so each migration must
stay compatible with the previous release. Additive changes are fine.
Removals are split over two releases.

A deploy restarts `web`, so the shop is unreachable for a few seconds.
That is acceptable at this size. Zero-downtime deploys need two web
containers behind Caddy, which we can add later.

### Backups

The `backup` service runs `scripts/backup.sh` every day (02:30 UTC). The
script records a `pg_dump` custom-format dump, and the row count of every
table read in the **same snapshot**. It also writes a checksum, keeps 14
dumps locally and copies them through an rclone **crypt** remote to
storage off the server. Unencrypted remotes are refused because the dumps
contain customer data.

After each backup, `scripts/restore-check.sh` restores the dump into a
scratch database. It requires exactly the recorded row counts, applies
today's migrations and drops the copy. Failures are logged and reported
through `SENTRY_DSN`. A real restore uses the same script with `--replace`
(see [backups](../operations/backups.md)), so the path we test every day
is the path we would use.

How much we can lose and how long recovery takes:

- **Data loss:** at most a day of data (the last backup). Every deploy
  takes an extra backup.
- **Recovery time:** about an hour on a new server. That covers
  installing Docker, a checkout, the settings files, restoring the newest
  off-site dump and deploying the same commit.

### Hosting: recommended Hetzner Cloud

The prices below were taken from the providers' sites on 2026-11-28,
excluding VAT. Several providers changed their prices during 2026, so
check them again before buying.

| Option                                                                                                                                                     | Monthly cost for this shop                                                                  | Notes                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hetzner Cloud**, one CX23 (2 vCPU, 4 GB, 40 GB NVMe) in Germany or Finland, with server backups (+20%) and a Storage Box BX11 (1 TB) for off-site copies | about **€11** (€5.99 + €1.20 + €3.20)                                                       | EU company and data centres. Everything in this repository runs as is. We maintain the server: security updates are automatic, Docker upgrades are not. Outgoing ports 25/465 are blocked, so mail goes through port 587 (fine for Brevo). |
| DigitalOcean App Platform (web and worker) with Managed PostgreSQL, Frankfurt                                                                              | about **$35–40** ($5–12 per container, $15 database)                                        | No server to maintain. Single-node database: no failover. Backups are the provider's; `restore-check.sh` would need a second database.                                                                                                     |
| Render, Frankfurt (web, background worker, Postgres)                                                                                                       | about **$20–40** ($7 + $7 + from $6, plus storage at $0.30/GB)                              | No server to maintain. Workers have no free tier. The Hobby workspace has limits; a team needs Pro (+$25).                                                                                                                                 |
| Scaleway, Paris (Serverless Containers with Managed PostgreSQL DEV-S)                                                                                      | about **€25+** (€11 database, plus containers billed by usage, and the worker never sleeps) | Billing by usage suits the web, not an always-on worker.                                                                                                                                                                                   |

**Recommendation: Hetzner Cloud, a CX23 in Falkenstein or Nuremberg
(about 30–40 ms from Sofia), with staging on the same server.**

It costs about a third of the managed options and keeps all data with an
EU company. The design above already covers what a platform would
otherwise provide: containers, health checks, migrations on deploy,
encrypted off-site backups and daily restore tests.

Its weakness is that we maintain the server. Unattended security updates
and the runbook keep that small. When traffic or the owner's appetite for
maintenance changes, move only the database to a managed PostgreSQL by
changing `DATABASE_URL`. The images run unchanged on any of the other
options.

**Transactional email: Brevo** (French company, EU data centres). The free
plan allows 300 emails a day, which covers early order volume; the paid
plan is $9 a month for 5,000. It uses SMTP on port 587 with an SPF/DKIM
domain set up in DNS.

## Consequences

**Positive:**

- The same tested images run everywhere.
- A deploy cannot start a version whose migrations failed.
- Every backup is restored the same night, and a real restore is a single
  tested command.
- Staging costs nothing extra.

**Negative:**

- One server is a single point of failure. Recovery is the documented
  restore of about an hour, with no failover.
- OS and Docker updates are our job.
- Deploys interrupt the shop for a few seconds.

**What the owner still provides:**

- the provider account and payment;
- the domain and DNS;
- a Brevo account;
- the GitHub environments, with their secrets and variables;
- a decision on the GHCR packages, which CI creates as private: make them
  public, or let the server log in with a read-only token
  ([runbook](../operations/runbook.md)).
