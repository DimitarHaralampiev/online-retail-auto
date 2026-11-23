// The shopper's selected vehicle: GET reads it, PUT sets it (from the
// selector, or from a garage vehicle of the signed-in customer) and DELETE
// clears it. The cookie holds ids only; every read re-resolves them.
import { cookies } from "next/headers";
import { z } from "zod";
import { currentCustomer, database } from "../../../lib/accounts";
import { json, requestJson, requireSameOrigin } from "../../../lib/order-http";
import {
  garageSelection,
  parseSelectionCookie,
  resolveSelection,
  saveToGarage,
  selectionCookieValue,
  selectionSchema,
  VEHICLE_COOKIE,
  VEHICLE_COOKIE_MAX_AGE,
  type ResolvedVehicle,
} from "../../../lib/vehicle-selection";
import { logError } from "../../../lib/log";

export const runtime = "nodejs";

const putSchema = z.union([
  selectionSchema.extend({ saveToGarage: z.boolean().default(false) }).strict(),
  z.object({ garageVehicleId: z.uuid() }).strict(),
]);

function withCookie(vehicle: ResolvedVehicle | null) {
  const response = json({ vehicle });
  response.cookies.set(
    VEHICLE_COOKIE,
    vehicle
      ? selectionCookieValue({
          generationId: vehicle.generationId,
          engineId: vehicle.engineId,
          year: vehicle.year,
        })
      : "",
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: vehicle ? VEHICLE_COOKIE_MAX_AGE : 0,
    },
  );
  return response;
}

function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return json({ error: "Невалиден автомобил." }, 400);
  const e = error as { code?: string; message?: string };
  if (!e.code && e.message && /^[А-Я]/u.test(e.message))
    return json({ error: e.message }, 400);
  void logError("Vehicle selection failed", e);
  return json({ error: "Изборът на автомобил временно не е достъпен." }, 503);
}

export async function GET() {
  try {
    const selection = parseSelectionCookie(
      (await cookies()).get(VEHICLE_COOKIE)?.value,
    );
    return json({
      vehicle: selection ? await resolveSelection(database(), selection) : null,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = putSchema.parse(await requestJson(request));
    const db = database();
    let selection;
    let save = false;
    if ("garageVehicleId" in body) {
      // Garage vehicles belong to the session's customer, never to an id
      // sent by the client alone.
      const customer = await currentCustomer();
      if (!customer) return json({ error: "Влез в профила си." }, 401);
      selection = await garageSelection(db, customer.id, body.garageVehicleId);
      if (!selection)
        return json(
          {
            error:
              "Този автомобил от гаража още не е свързан със справочника. Избери го от менюто.",
          },
          404,
        );
    } else {
      const { saveToGarage: wanted, ...rest } = body;
      selection = rest;
      save = wanted;
    }
    const vehicle = await resolveSelection(db, selection);
    if (!vehicle)
      return json({ error: "Автомобилът не е намерен в справочника." }, 404);
    if (save) {
      const customer = await currentCustomer();
      if (!customer) return json({ error: "Влез в профила си." }, 401);
      await saveToGarage(db, customer.id, vehicle);
    }
    return withCookie(vehicle);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    return withCookie(null);
  } catch (error) {
    return failure(error);
  }
}
