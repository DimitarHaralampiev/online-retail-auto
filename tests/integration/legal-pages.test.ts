import assert from "node:assert/strict";
import { test } from "node:test";
import { AdminProductError } from "../../src/lib/admin-products";
import { getLegalPage, saveLegalPage } from "../../src/lib/legal";
import { insertCustomer, setupTestDatabase } from "./database";

let adminId = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    adminId = await insertCustomer(pool, { isAdmin: true });
  },
});

const rejects = (promise: Promise<unknown>, status: number, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminProductError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });

test("an unsaved page is empty at version 0", async () => {
  assert.deepEqual(await getLegalPage(db().pool, "terms"), {
    slug: "terms",
    contentBg: "",
    contentEn: "",
    version: 0,
    updatedAt: null,
  });
});

test("saving stores trimmed text, bumps the version and is audited", async () => {
  const { pool } = db();
  const saved = await saveLegalPage(pool, adminId, "terms", {
    version: 0,
    contentBg: "  # Общи условия\r\n\r\nТекст от юрист.  ",
    contentEn: "",
  });
  assert.equal(saved.version, 1);
  assert.equal(saved.contentBg, "# Общи условия\n\nТекст от юрист.");
  assert.ok(saved.updatedAt);
  const audit = await pool.query(
    "SELECT entity_id, details FROM admin_audit_log WHERE action='legal.update'",
  );
  assert.deepEqual(audit.rows, [
    {
      entity_id: "terms",
      details: {
        bg: { from: 0, to: saved.contentBg.length },
        en: { from: 0, to: 0 },
      },
    },
  ]);
});

test("stale versions get 409; unchanged saves change nothing", async () => {
  const { pool } = db();
  await rejects(
    saveLegalPage(pool, adminId, "terms", {
      version: 0,
      contentBg: "x",
      contentEn: "",
    }),
    409,
    /променен междувременно/,
  );
  const same = await saveLegalPage(pool, adminId, "terms", {
    version: 1,
    contentBg: "# Общи условия\n\nТекст от юрист.",
    contentEn: "",
  });
  assert.equal(same.version, 1);
  const audit = await pool.query(
    "SELECT count(*)::int n FROM admin_audit_log WHERE action='legal.update'",
  );
  assert.equal(audit.rows[0].n, 1);
});

test("control characters and oversized texts are refused", async () => {
  const { pool } = db();
  await rejects(
    saveLegalPage(pool, adminId, "privacy", {
      version: 0,
      contentBg: "a\u0000b",
      contentEn: "",
    }),
    400,
    /недопустими знаци/,
  );
  await assert.rejects(
    saveLegalPage(pool, adminId, "privacy", {
      version: 0,
      contentBg: "я".repeat(100_001),
      contentEn: "",
    }),
    (e: { code?: string }) => e.code === "23514",
  );
});
