# Backups and restores

Decided in [ADR 0007](../architecture/0007-hosting-and-deployment.md) and
built in #56. The commands are run in the environment's checkout on the
server ([runbook](runbook.md)).

## What happens automatically

Every day at `BACKUP_AT` (UTC, default 02:30), the `backup` service runs
`scripts/backup.sh`. It also runs at start when the newest backup is more
than a day old. Every deploy takes one more backup before migrating.

Each backup writes three files to the `backups` volume:

| File                      | Contents                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `auto-shop-<time>.dump`   | `pg_dump` custom format, compressed. Kept only if `pg_restore` can read it.                                             |
| `auto-shop-<time>.counts` | The rows of every table, counted in the dump's own snapshot, so the numbers match it exactly even while orders come in. |
| `auto-shop-<time>.sha256` | The dump's checksum.                                                                                                    |

The newest `BACKUP_KEEP` dumps (default 14) stay on the server.

When `BACKUP_REMOTE` is set, the files are also copied off the server
through an rclone **crypt** remote. Copies older than
`BACKUP_REMOTE_KEEP_DAYS` (default 30) are deleted there. The script
refuses a remote that isn't encrypted, because the dumps hold customer
names, addresses and orders.

Right after each backup, `scripts/restore-check.sh` restores it into a
scratch database `restore_check_<time>_<pid>`. It requires exactly the
recorded row counts, applies today's migrations and drops the copy.

A failed backup or check logs a JSON `"level":"error"` line and reports it
to Sentry (`SENTRY_DSN` in `deploy/backup.env`). The next day's run happens
regardless.

The server provider's own backups of the whole server (Hetzner: +20%) are
a useful extra layer. They are not a replacement: they live with the same
provider and aren't checked by us.

## Setting up the off-site copy

The setup below uses a Hetzner Storage Box over SFTP. Any rclone storage
works, such as an S3 bucket; see `deploy/backup.env.example`.

1. Create the Storage Box and turn on SSH access. Make a sub-account
   limited to one folder, for example `auto-shop`.
2. Make two long random passwords: the crypt password and its salt.
   Store both in a password manager **outside the server**. Without them
   the copies cannot be read, not even by us.
3. In `deploy/backup.env`, set the following (`rclone obscure` runs in
   the tasks image, for example
   `deploy/compose.sh run --rm backup rclone obscure '<password>'`):
   ```sh
   RCLONE_CONFIG_BOX_TYPE=sftp
   RCLONE_CONFIG_BOX_HOST=<user>.your-storagebox.de
   RCLONE_CONFIG_BOX_PORT=23
   RCLONE_CONFIG_BOX_USER=<sub-account>
   RCLONE_CONFIG_BOX_PASS=<rclone obscure output>
   RCLONE_CONFIG_OFFSITE_TYPE=crypt
   RCLONE_CONFIG_OFFSITE_REMOTE=box:auto-shop
   RCLONE_CONFIG_OFFSITE_PASSWORD=<rclone obscure output>
   RCLONE_CONFIG_OFFSITE_PASSWORD2=<rclone obscure output of the salt>
   BACKUP_REMOTE=offsite:production
   ```
4. Run `deploy/compose.sh up -d backup` to restart the service with the
   new settings, then test the setup:
   - `deploy/compose.sh run --rm backup scripts/backup.sh` takes a backup;
   - `deploy/compose.sh run --rm backup rclone lsf offsite:production`
     lists the copies by their decrypted names.

## Checking by hand

```sh
deploy/compose.sh run --rm backup ls -l /backups
deploy/compose.sh run --rm backup scripts/restore-check.sh                 # newest
deploy/compose.sh run --rm backup scripts/restore-check.sh /backups/auto-shop-<time>.dump
```

Once a quarter, restore an **off-site** copy too. This proves that the
crypt passwords in the password manager still work.

```sh
deploy/compose.sh run --rm backup sh -c \
  'mkdir -p /backups/offsite-test && rclone copy offsite:production /backups/offsite-test --include "auto-shop-<time>.*" &&
   scripts/restore-check.sh /backups/offsite-test/auto-shop-<time>.dump; rm -rf /backups/offsite-test'
```

## Restoring for real

Restore when data was lost or damaged and fixing it by hand isn't
possible. Everything written after the backup is lost, so pick the newest
good backup, and write down which orders came in after it. Their emails
are in the shop's mailbox and Stripe keeps its payments.

1. **Stop the shop**, so nobody writes to the old database:
   ```sh
   deploy/compose.sh stop web worker backup
   ```
2. **Fetch the backup** if it isn't on the server (from the off-site
   copy):
   ```sh
   deploy/compose.sh run --rm backup rclone copy offsite:production /backups --include "auto-shop-<time>.*"
   ```
3. **Restore it.** The script checks the backup exactly as the daily check
   does, then renames the current database to `auto_before_<time>` and
   puts the restored copy in its place. It refuses while anything is still
   connected.
   ```sh
   deploy/compose.sh run --rm backup scripts/restore-check.sh /backups/auto-shop-<time>.dump --replace
   ```
4. **Start the shop** and check it:
   ```sh
   deploy/compose.sh up -d web worker backup
   curl -s http://127.0.0.1:3000/api/health
   ```
   Then sign in to `/admin` and look at the latest orders.
5. **Clean up.** After a few days, when nothing is missing, drop the old
   database:
   ```sh
   deploy/compose.sh exec db psql -U auto -d postgres -c 'DROP DATABASE "auto_before_<time>"'
   ```

On a **new server**, set it up as in the [runbook](runbook.md) up to the
settings files, using the same `DB_PASSWORD` or a new one. Deploy the
commit in the old `deploy/release.env`, or the newest `main`, then
continue with step 1.
