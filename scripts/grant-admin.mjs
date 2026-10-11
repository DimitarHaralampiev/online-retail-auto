import pg from "pg";
const email = process.argv[2]?.trim().toLowerCase();
if (!email)
  throw new Error("Usage: npm run admin:grant -- verified-email@example.com");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(
    "UPDATE customers SET is_admin=true WHERE email=$1 AND email_verified_at IS NOT NULL RETURNING id",
    [email],
  );
  if (!result.rowCount) throw new Error("A verified customer is required.");
  console.log("Administrator access granted.");
} finally {
  await pool.end();
}
