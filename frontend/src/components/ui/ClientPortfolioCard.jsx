import { Link } from "react-router-dom";
import { ArrowRight, FolderOpen, Layers3, MapPinned, ShieldCheck } from "lucide-react";
import ProgressBar from "./ProgressBar";
import { formatArea } from "../../utils/parcelGeometry";
import { getParcelStatusLabel, progressFromStatus } from "../../constants/parcelConstants";

function computeAverageProgress(parcels) {
  if (!Array.isArray(parcels) || parcels.length === 0) return 0;
  const total = parcels.reduce(
    (sum, parcel) => sum + Number(parcel.progress ?? progressFromStatus(parcel.status) ?? 0),
    0,
  );
  return Math.round(total / parcels.length);
}

export default function ClientPortfolioCard({ group, isInternalPortal = false, onEditParcel }) {
  const { clientCode, ownerLabel, parcels = [] } = group;
  const leadParcel = parcels[0] || null;
  const communes = [...new Set(parcels.map((parcel) => parcel.commune).filter(Boolean))];
  const averageProgress = computeAverageProgress(parcels);

  if (!leadParcel) return null;

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
      <div className="flex flex-col gap-5 border-b border-mapgeo-line pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-mapgeo-secondary/60">Portefeuille client</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-bold text-mapgeo-primary">{clientCode || ownerLabel || "Client"}</h3>
            {ownerLabel ? (
              <span className="rounded-full border border-mapgeo-line bg-mapgeo-ivory px-3 py-1.5 text-xs font-semibold text-mapgeo-primary">
                <ShieldCheck size={14} className="mr-1 inline" /> {ownerLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">
            {parcels.length} parcelle{parcels.length > 1 ? "s" : ""}
            {communes.length ? ` · ${communes.join(" · ")}` : ""}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 xl:max-w-sm">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 p-4">
              <p className="text-mapgeo-secondary/60">Parcelles</p>
              <p className="mt-2 text-lg font-bold text-mapgeo-primary">{parcels.length}</p>
            </div>
            <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 p-4">
              <p className="text-mapgeo-secondary/60">Communes</p>
              <p className="mt-2 text-lg font-bold text-mapgeo-primary">{communes.length || 1}</p>
            </div>
            <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 p-4">
              <p className="text-mapgeo-secondary/60">Avancement</p>
              <p className="mt-2 text-lg font-bold text-mapgeo-primary">{averageProgress}%</p>
            </div>
          </div>

          <Link
            to={`/parcelles/${leadParcel.id}/carto`}
            state={{ returnTo: "/parcelles" }}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-4 py-3 font-semibold text-white transition hover:bg-mapgeo-secondary"
          >
            <Layers3 size={18} /> Ouvrir le portefeuille cartographique <ArrowRight size={18} />
          </Link>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {parcels.map((parcel) => (
          <article
            key={parcel.id}
            className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/30 px-5 py-4 transition hover:border-mapgeo-secondary/25"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h4 className="text-lg font-bold text-mapgeo-primary">{parcel.reference}</h4>
                  <span className="rounded-full border border-mapgeo-line bg-white px-3 py-1.5 text-xs font-semibold text-mapgeo-primary">
                    {getParcelStatusLabel(parcel.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-mapgeo-secondary/75">
                  {parcel.location || parcel.commune || "Sans localisation"}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-mapgeo-secondary/75">
                  <span className="inline-flex items-center gap-2">
                    <MapPinned size={14} /> {parcel.commune || "Commune non renseignée"}
                  </span>
                  <span>{formatArea(parcel.area)}</span>
                </div>
              </div>

              <div className="w-full xl:max-w-[360px]">
                <ProgressBar value={parcel.progress ?? progressFromStatus(parcel.status)} />
                <div className="mt-3 flex flex-wrap gap-3">
                  <Link
                    to={`/parcelles/${parcel.id}`}
                    className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-semibold text-mapgeo-primary"
                  >
                    <FolderOpen size={16} /> Ouvrir le dossier
                  </Link>

                  {isInternalPortal ? (
                    <button
                      type="button"
                      onClick={() => onEditParcel?.(parcel.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory px-4 py-3 text-sm font-semibold text-mapgeo-primary"
                    >
                      Préparer l’édition
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
