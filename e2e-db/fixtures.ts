// What e2e-db/serve.ts prepared, for the tests: sessions of fictional users
// and ids in the disposable database.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";

export const FIXTURES_FILE = path.join(__dirname, ".fixtures.json");

export type Fixtures = {
  /** Session tokens (the auto_session cookie). */
  admin: string;
  customer: string;
  /** auto_vehicle cookie value for "Testmake Alpha Alpha I, 2014, 1.6 diesel". */
  vehicle: string;
};

export const fixtures = (): Fixtures =>
  JSON.parse(readFileSync(FIXTURES_FILE, "utf8"));

export async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token: string,
) {
  await context.addCookies([
    { name: "auto_session", value: token, url: baseURL! },
  ]);
}
