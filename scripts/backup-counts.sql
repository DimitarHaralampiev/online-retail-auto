-- Row count of every table (#56). backup.sh runs it in the snapshot of the
-- dump and stores the result next to it; restore-check.sh runs it on the
-- restored copy and requires the same output.
SELECT format('SELECT %L, count(*) FROM %I.%I', table_name, table_schema, table_name)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name
\gexec
