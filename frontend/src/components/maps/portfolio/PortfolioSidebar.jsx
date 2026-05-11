import { ArrowUpDown, Filter, Plus, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";

function formatCardDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function SelectBox({ value, onChange, children, label }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mapgeo-dark-select w-full rounded-xl border border-white/10 bg-[#0d1a27] px-3 py-3 text-sm font-medium text-white/80 outline-none transition focus:border-mapgeo-sand/50"
      >
        {children}
      </select>
    </label>
  );
}

function ParcelListCard({ feature, active, onClick }) {
  const parcel = feature.parcel || {};
  const client = parcel.owner_client_code || "—";
  const owner = parcel.owner_name || "—";
  const location = parcel.location || parcel.commune || parcel.village || "—";
  const createdAt = formatCardDate(parcel.created_at || parcel.created || parcel.planned_date || parcel.planned_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        active
          ? "border-mapgeo-sand/75 bg-mapgeo-sand/20 text-white shadow-soft"
          : "border-white/10 bg-white/[0.045] text-white hover:border-white/20 hover:bg-white/[0.075]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold tracking-tight">{parcel.reference || "Parcelle sans référence"}</p>
        </div>
        <span className="shrink-0 rounded-full bg-mapgeo-sand/20 px-2.5 py-1 text-[10px] font-bold text-mapgeo-ivory ring-1 ring-mapgeo-sand/20">
          {feature.statusLabel}
        </span>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/50">Client :</span>
          <strong className="max-w-[150px] truncate text-right text-white/80">{client}</strong>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/50">Propriétaire :</span>
          <strong className="max-w-[150px] truncate text-right text-white/80">{owner}</strong>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/50">Surface :</span>
          <strong className="text-right text-white/80" title={`Calculée : ${feature.computedAreaLabel || "—"} · Officielle : ${feature.officialAreaLabel || "—"}`}>{feature.areaLabel}</strong>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/50">Localisation :</span>
          <strong className="max-w-[150px] truncate text-right text-white/80">{location}</strong>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/50">Créée le :</span>
          <strong className="text-right text-white/80">{createdAt}</strong>
        </div>
      </div>
    </button>
  );
}

export default function PortfolioSidebar({
  clientCode,
  ownerName,
  features,
  searchTerm,
  searchMode,
  onSearchTermChange,
  onSearchModeChange,
  onSearchSubmit,
  filteredFeatures,
  activeFeature,
  canCreateParcel = false,
  onCreateParcel,
  onFeatureSelection,
}) {
  const [selectedCommune, setSelectedCommune] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState("recent");
  const [sortDirection, setSortDirection] = useState("desc");

  const communes = useMemo(
    () => Array.from(new Set(features.map((feature) => feature.parcel.commune).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [features],
  );
  const statuses = useMemo(
    () => Array.from(new Set(features.map((feature) => feature.statusLabel).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [features],
  );

  const visibleRows = useMemo(() => {
    const rows = filteredFeatures.filter((feature) => {
      const communeOk = !selectedCommune || feature.parcel.commune === selectedCommune;
      const statusOk = !selectedStatus || feature.statusLabel === selectedStatus;
      return communeOk && statusOk;
    });

    const getDate = (feature) => Date.parse(feature.parcel.updated_at || feature.parcel.created_at || 0) || 0;
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "surface") return (a.computedAreaValue || a.officialAreaValue || 0) - (b.computedAreaValue || b.officialAreaValue || 0);
      if (sortKey === "commune") return String(a.parcel.commune || "").localeCompare(String(b.parcel.commune || ""), "fr");
      if (sortKey === "reference") return String(a.parcel.reference || "").localeCompare(String(b.parcel.reference || ""), "fr", { numeric: true });
      if (sortKey === "status") return String(a.statusLabel || "").localeCompare(String(b.statusLabel || ""), "fr");
      return getDate(a) - getDate(b);
    });

    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }, [filteredFeatures, selectedCommune, selectedStatus, sortKey, sortDirection]);

  const resetFilters = () => {
    setSelectedCommune("");
    setSelectedStatus("");
    onSearchTermChange("");
    onSearchModeChange("reference");
    setSortKey("recent");
    setSortDirection("desc");
  };

  return (
    <aside className="order-2 flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-white/10 bg-[#0c1a28]/96 text-white shadow-[0_24px_80px_rgba(0,0,0,0.28)] lg:order-1">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold tracking-tight">Recherche</h2>
            <p className="mt-1 text-xs text-white/40">{clientCode || ownerName || "Carte de travail"}</p>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className={`grid h-10 w-10 place-items-center rounded-xl border text-white/70 transition hover:bg-white/10 ${filtersOpen ? "border-mapgeo-sand/50 bg-mapgeo-primary/25 text-white" : "border-white/10 bg-white/5"}`}
            title={filtersOpen ? "Masquer les filtres" : "Afficher les filtres"}
            aria-label={filtersOpen ? "Masquer les filtres" : "Afficher les filtres"}
          >
            <Filter size={17} />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSearchSubmit?.();
          }}
          className="mt-4 space-y-3"
        >
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={17} />
              <input
                value={searchTerm}
                onChange={(event) => onSearchTermChange(event.target.value)}
                onFocus={() => {
                  if (!searchMode) onSearchModeChange("reference");
                }}
                placeholder="Référence, commune, client…"
                className="w-full rounded-xl border border-white/10 bg-white/[0.045] py-3 pl-10 pr-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-mapgeo-sand/50"
              />
            </div>
            <button type="submit" aria-label="Lancer la recherche" className="grid h-[46px] w-[46px] place-items-center rounded-xl bg-mapgeo-primary text-white shadow-soft">
              <Search size={18} />
            </button>
          </div>

          {filtersOpen ? (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <SelectBox
                value={selectedCommune}
                onChange={setSelectedCommune}
                label="Commune"
              >
                <option value="">Toutes les communes</option>
                {communes.map((commune) => (
                  <option key={commune} value={commune}>{commune}</option>
                ))}
              </SelectBox>

              <SelectBox value={selectedStatus} onChange={setSelectedStatus} label="Statut">
                <option value="">Tous les statuts</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </SelectBox>
            </div>
          ) : null}

          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-2 rounded-xl px-1 py-1 text-sm font-semibold text-mapgeo-sand hover:text-mapgeo-sand"
          >
            <RotateCcw size={15} /> Réinitialiser les filtres
          </button>

        </form>

        <div className="mt-8 flex items-center justify-between gap-3">
          <h3 className="text-base font-extrabold tracking-tight">
            Parcelles <span className="text-white/50">({visibleRows.length})</span>
          </h3>
          <button
            type="button"
            onClick={() => setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))}
            className="text-white/60 hover:text-white"
            title="Inverser l’ordre de tri"
          >
            <ArrowUpDown size={18} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-2 text-sm text-white/70">
          <SelectBox value={sortKey} onChange={setSortKey} label="Tri">
            <option value="recent">Plus récentes</option>
            <option value="reference">Référence</option>
            <option value="commune">Commune</option>
            <option value="surface">Surface</option>
            <option value="status">Statut</option>
          </SelectBox>
          <button
            type="button"
            onClick={() => setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))}
            className="rounded-xl border border-white/10 bg-[#0d1a27] px-3 text-xs font-extrabold text-white/80 hover:bg-white/10"
            title="Changer le sens du tri"
          >
            {sortDirection === "asc" ? "A→Z" : "Z→A"}
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {visibleRows.length ? (
            visibleRows.map((feature) => {
              const active = String(feature.id) === String(activeFeature?.id);
              return (
                <ParcelListCard
                  key={feature.id}
                  feature={feature}
                  active={active}
                  onClick={() => onFeatureSelection?.(feature)}
                />
              );
            })
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm leading-6 text-white/60">
              {features.length
                ? "Aucune parcelle ne correspond à cette recherche."
                : "Aucune parcelle disponible. La carte reste utilisable pour les fonds, couches SIG, coordonnées et mesures."}
            </div>
          )}
        </div>
      </div>

      {canCreateParcel ? (
        <div className="border-t border-white/10 p-4">
          <button
            type="button"
            onClick={onCreateParcel}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-mapgeo-primary px-4 py-3.5 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-sand"
          >
            <Plus size={19} /> Créer une parcelle
          </button>
        </div>
      ) : null}
    </aside>
  );
}
