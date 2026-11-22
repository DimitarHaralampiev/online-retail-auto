// Public vehicle reference lookups for cascading selectors:
// ?level=makes | models&parent=<make id> | generations&parent=<model id>
// | engines&parent=<generation id>. Read-only and cacheable.
import { NextResponse } from "next/server";
import { z } from "zod";
import { database } from "../../../lib/accounts";
import {
  listEngines,
  listGenerations,
  listMakes,
  listModels,
} from "../../../lib/vehicles";

export const runtime = "nodejs";

const querySchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("makes") }),
  z.object({ level: z.literal("models"), parent: z.uuid() }),
  z.object({ level: z.literal("generations"), parent: z.uuid() }),
  z.object({ level: z.literal("engines"), parent: z.uuid() }),
]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = querySchema.safeParse({
    level: params.get("level"),
    parent: params.get("parent") ?? undefined,
  });
  if (!query.success)
    return NextResponse.json(
      { error: "Невалидна заявка." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const db = database();
    const q = query.data;
    const items =
      q.level === "makes"
        ? await listMakes(db)
        : q.level === "models"
          ? await listModels(db, q.parent)
          : q.level === "generations"
            ? await listGenerations(db, q.parent)
            : await listEngines(db, q.parent);
    return NextResponse.json(
      { items },
      {
        headers: {
          // Reference data changes rarely; hidden entries vanish within minutes.
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      },
    );
  } catch (error) {
    console.error(
      "Vehicle lookup failed",
      (error as { code?: string }).code ?? "service configuration",
    );
    return NextResponse.json(
      { error: "Справочникът временно не е достъпен." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
