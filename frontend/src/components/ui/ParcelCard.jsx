import { Link } from "react-router-dom";
import { ArrowRight, MapPinned, ScanLine, ShieldCheck } from "lucide-react";
import ProgressBar from "./ProgressBar";
import { premium } from "./designSystem";
import { formatArea } from "../../utils/parcelGeometry";
import { getParcelStatusLabel, progressFromStatus } from "../../constants/parcelConstants";

export default function ParcelCard({ parcel }) {
  return (
    <div className={`${premium.card} flex flex-col gap-6 p-6`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-mapgeo-secondary/60">Parcelle</p>
          <h3 className="mt-2 text-2xl font-bold text-mapgeo-primary">{parcel.reference}</h3>
          <p className="mt-2 text-mapgeo-secondary/75">{parcel.location || parcel.commune || "Sans localisation"}</p>
        </div>

        <span className={premium.badge}>
          {getParcelStatusLabel(parcel.status)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/55 p-4">
          <div className="flex items-center gap-2 text-mapgeo-primary">
            <ScanLine size={16} /> Surface
          </div>
          <p className="mt-3 text-lg font-bold text-mapgeo-primary">{formatArea(parcel.area)}</p>
        </div>

        <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/55 p-4">
          <div className="flex items-center gap-2 text-mapgeo-primary">
            <MapPinned size={16} /> Commune
          </div>
          <p className="mt-3 text-lg font-bold text-mapgeo-primary">{parcel.commune || "—"}</p>
        </div>

        <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/55 p-4">
          <div className="flex items-center gap-2 text-mapgeo-primary">
            <ShieldCheck size={16} /> Client
          </div>
          <p className="mt-3 text-lg font-bold text-mapgeo-primary">{parcel.owner_client_code || parcel.owner_name || "—"}</p>
        </div>
      </div>

      <ProgressBar value={parcel.progress ?? progressFromStatus(parcel.status)} />

      <div className="flex flex-col gap-3 md:flex-row">
        <Link
          to={`/parcelles/${parcel.id}`}
          className={`${premium.buttonSecondary} flex-1`}
        >
          Ouvrir le dossier <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
