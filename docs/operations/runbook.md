# Running the shop on a server

How production and staging run on one server, as decided in
[ADR 0007](../architecture/0007-hosting-and-deployment.md). Backups and
restores are covered in [backups.md](backups.md).

## What runs where

```text
            internet ─▶ Caddy :443 (deploy/proxy, HTTPS)
                         │
         ┌───────────────┴───────────────┐
         ▼ 127.0.0.1:3000                ▼ 127.0.0.1:3001 (password)
  auto-shop-production              auto-shop-staging
  web  worker  backup  db           web  worker  backup  db
```

Each environment is a checkout under `/srv/auto-shop/<environment>`. It
has its own settings (git ignores all three):

| File                | What it holds                                                | Template                     |
| ------------------- | ------------------------------------------------------------ | ---------------------------- |
| `deploy/.env`       | `SHOP_ENVIRONMENT`, `DB_PASSWORD`, `WEB_PORT`, `SHOP_IMAGES` | `deploy/compose.env.example` |
| `deploy/app.env`    | the shop's settings, read by web and worker                  | `.env.example`               |
| `deploy/backup.env` | backup time, retention, off-site storage, `SENTRY_DSN`       | `deploy/backup.env.example`  |

`deploy/release.env` is written by every deploy and names the images in
use.

## Setting up a server (once)

These steps assume Ubuntu 24.04 LTS with at least 4 GB of RAM.

1. **Firewall and updates.** In the provider's firewall, allow only 22,
   80 and 443. Then:
   ```sh
   sudo apt update && sudo apt full-upgrade -y && sudo apt install -y unattended-upgrades git curl
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```
2. **Docker Engine** with the Compose plugin, from Docker's apt
   repository (<https://docs.docker.com/engine/install/ubuntu/>). Then
   create a `deploy` user in the `docker` group. Membership in that group
   amounts to root on this server, so use the user for nothing else.
3. **Checkouts**, one per environment:
   ```sh
   sudo mkdir -p /srv/auto-shop && sudo chown deploy: /srv/auto-shop
   cd /srv/auto-shop
   git clone https://github.com/DimitarHaralampiev/online-retail-auto.git production
   git clone https://github.com/DimitarHaralampiev/online-retail-auto.git staging
   ```
4. **Settings.** In each checkout, copy the templates and fill them in.
   - Production `app.env`: `APP_URL=https://<domain>`,
     `CATALOG_SOURCE=postgres`, a new `ORDER_TRACKING_SECRET`
     (`openssl rand -hex 32`), the SMTP settings of the mail service, the
     `COMPANY_*` details, Stripe live keys (#54) and `SENTRY_DSN`. Leave
     `SITE_INDEXABLE` unset until launch.
   - Staging: `SHOP_ENVIRONMENT=staging` and `WEB_PORT=3001`, its own
     `DB_PASSWORD` and secrets, Stripe _test_ keys, and never
     `SITE_INDEXABLE`.
   - Restrict the files to the owner: `chmod 600 deploy/*.env`.
5. **Images.** CI publishes them to GHCR. New packages start private, so
   do one of the following:
   - make `online-retail-auto-web` and `online-retail-auto-tasks` public
     (GitHub → Packages → Package settings), or
   - as the `deploy` user, run
     `docker login ghcr.io -u <github user>` with a token that has only
     `read:packages`.
6. **HTTPS.**
   - Point the domain (and `www`, and `staging.`) at the server.
   - Copy `deploy/proxy/Caddyfile.example` to `deploy/proxy/Caddyfile` in
     the production checkout and set the domains, the email address and
     the staging password hash.
   - Run `docker compose -f deploy/proxy/compose.yaml up -d`.
7. **Deploys from GitHub.**
   - Copy `deploy/ssh-deploy.sh` to `/srv/auto-shop/ssh-deploy.sh`, owned
     by root and not writable by `deploy`.
   - Create a key pair just for CI and add it to
     `~deploy/.ssh/authorized_keys` as
     `command="/srv/auto-shop/ssh-deploy.sh",restrict ssh-ed25519 AAAA… ci-deploy`.
   - In GitHub, under Settings → Environments, create `staging` and
     `production`, and give production required reviewers. For each, add:
     - the secret `DEPLOY_SSH_KEY` (the private key);
     - the variable `DEPLOY_TARGET` (`deploy@<server>`);
     - the variable `DEPLOY_KNOWN_HOSTS` (the output of
       `ssh-keyscan -t ed25519 <server>`).
8. **First deploy**, staging first. Run Actions → Deploy → `staging`.
   Then, as the `deploy` user, create the first admin account in the shop
   and grant it the admin role:
   ```sh
   cd /srv/auto-shop/staging
   deploy/compose.sh run --rm migrate node scripts/grant-admin.mjs <email>
   ```
   Repeat for production.

## Deploying

The usual way is **Actions → Deploy → Run workflow** (from `main`): first
`staging`, check the shop, then `production`. The workflow refuses
commits whose CI run on `main` did not pass.

By hand on the server, which runs the same steps:

```sh
cd /srv/auto-shop/staging && deploy/deploy.sh <full commit sha>
```

`deploy.sh` checks out the commit, pulls its images, backs up the
database, applies the migrations and then starts the new version. If a
step fails, it stops and says which one.

- **Before the new version starts:** nothing has changed, and the old
  version is still serving.
- **The new version is unhealthy:** read
  `deploy/compose.sh logs --tail 200 web` and deploy the previous commit
  again.

**Rolling back** means deploying the previous commit:
`grep SHOP_RELEASE deploy/release.env` before deploying shows the current
one, and the Deploy history on GitHub lists the earlier ones.

Migrations only ever move forward, but they are additive, so the previous
release still runs on the newer schema. When a release removes something
from the schema, say so in its pull request and keep a backup to restore
instead ([backups.md](backups.md)).

## Everyday commands

Run these in the environment's checkout.

| Task                                | Command                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| What runs, and is it healthy        | `deploy/compose.sh ps`                                                         |
| Logs (JSON lines, with `requestId`) | `deploy/compose.sh logs --tail 100 web worker backup`                          |
| Health of the shop                  | `curl -s http://127.0.0.1:3000/api/health`                                     |
| Run every worker job once           | `deploy/compose.sh run --rm worker node --import tsx scripts/worker.ts --once` |
| Check the SMTP settings             | `deploy/compose.sh run --rm worker node --import tsx scripts/check-mail.ts`    |
| PostgreSQL shell                    | `deploy/compose.sh exec db psql -U auto -d auto`                               |
| Restart one service                 | `deploy/compose.sh restart worker`                                             |

**Watch for:**

- **The worker:** `deploy/compose.sh ps` must show it `Up`.
- **Failed emails** under `/admin/orders`.
- **Error reports** in Sentry, including failed backups.
- **Disk space** (`df -h`). Backups, logs and images grow. Old shop images
  are pruned on each deploy.

## Security notes

- Only Caddy is reachable from outside. The web port listens on
  127.0.0.1, and PostgreSQL has no published port at all.
- Secrets live only in the `deploy/*.env` files on the server and in
  GitHub environment secrets. They are never baked into images or
  committed.
- The CI key can only run `ssh-deploy.sh` with a known environment and a
  40-character commit. `restrict` turns off shells, port forwarding and
  agent forwarding.
- If a CDN or load balancer is ever put in front of Caddy, configure
  Caddy's `trusted_proxies` for it. Otherwise every visitor shares the
  CDN's address in the rate limits.
