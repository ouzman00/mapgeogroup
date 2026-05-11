import { LocateFixed, X } from "lucide-react";
import { formatCoordinate } from "./mapUtils";

function Row({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <span className="text-white/55">{label}</span>
      <strong className="max-w-[180px] truncate text-right text-white">{value || "—"}</strong>
    </div>
  );
}

export default function IdentifyCard({ feature, onClose, onOpenParcel }) {
  if (!feature) return null;

  const parcel = feature.parcel || {};
  const location = parcel.commune || parcel.location || parcel.village || "—";
  const client = parcel.owner_name || parcel.owner_client_code || "";
  const centerLabel = Array.isArray(feature.center)
    ? `${formatCoordinate(feature.center[0], 5)}, ${formatCoordinate(feature.center[1], 5)}`
    : "";

  return (
    <div className="absolute right-4 top-4 z-[900] w-[300px] max-w-[calc(100%-2rem)] rounded-[18px] border border-white/10 bg-[#07111b]/92 p-3 text-white shadow-[0_24px_75px_rgba(0,0,0,0.34)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Parcelle sélectionnée</p>
          <h3 className="mt-1 truncate text-lg font-extrabold">{parcel.reference || "Parcelle"}</h3>
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Fermer l’identification">
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 grid gap-1.5 text-sm">
        <Row label="Statut" value={feature.statusLabel} />
        <Row label="Surface" value={feature.areaLabel} />
        <Row label="Commune" value={location} />
        <Row label="Client" value={client} />
        <Row label="Centre" value={centerLabel} />
      </div>

      <button type="button" onClick={() => onOpenParcel?.(feature)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-mapgeo-primary px-3 py-2.5 text-sm font-extrabold text-white hover:bg-mapgeo-sand">
        <LocateFixed size={15} /> Voir dans le panneau
      </button>
    </div>
  );
}
