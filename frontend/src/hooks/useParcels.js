import { useContext } from "react";
import { ParcelContext } from "../context/ParcelContext";

export default function useParcels() {
  const context = useContext(ParcelContext);

  if (!context) {
    throw new Error("useParcels doit être utilisé dans un ParcelProvider.");
  }

  return context;
}
