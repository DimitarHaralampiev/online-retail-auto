"use client";
// The shopper's selected vehicle for client components (#94). The layout
// resolves it on the server; changing it refreshes the route, which renders
// the provider again with the new value.
import { createContext, useContext } from "react";

export type HeaderVehicle = { label: string } | null;

const VehicleContext = createContext<HeaderVehicle>(null);

export default function VehicleProvider({
  vehicle,
  children,
}: {
  vehicle: HeaderVehicle;
  children: React.ReactNode;
}) {
  return (
    <VehicleContext.Provider value={vehicle}>
      {children}
    </VehicleContext.Provider>
  );
}

export const useSelectedVehicle = () => useContext(VehicleContext);
