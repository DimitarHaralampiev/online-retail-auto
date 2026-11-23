// The request's selected vehicle (#94), resolved once per request and shared
// by the layout (header) and the pages that filter by it. Only with the
// PostgreSQL catalog, where the vehicle reference lives.
import { cookies } from "next/headers";
import { cache } from "react";
import { database } from "./accounts";
import { catalogSource } from "./catalog-server";
import {
  VEHICLE_COOKIE,
  vehicleFromCookie,
  type ResolvedVehicle,
} from "./vehicle-selection";

export const selectedVehicle = cache(
  async (): Promise<ResolvedVehicle | null> => {
    if (catalogSource() !== "postgres" || !process.env.DATABASE_URL)
      return null;
    return vehicleFromCookie(
      database(),
      (await cookies()).get(VEHICLE_COOKIE)?.value,
    );
  },
);
