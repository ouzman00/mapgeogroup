export default function ParcelMetricsPanel({ parcel, areaLabel, perimeterLabel, vertexRows, statusLabel, geometryWarning }) {
  return (
    <aside className="rounded-[32px] border border-white/10 bg-[#123B5D] p-5 text-white shadow-panel">
      <p className="text-xs uppercase tracking-[0.22em] text-mapgeo-sand/80">Vue parcellaire</p>
      <h3 className="mt-3 text-2xl font-bold">{parcel.reference}</h3>
      <p className="mt-2 text-white/70">{parcel.location || parcel.commune || "Sans localisation"}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="text-white/50">Statut</p>
          <p className="mt-1 font-semibold">{statusLabel}</p>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="text-white/50">Propriétaire</p>
          <p className="mt-1 font-semibold">{parcel.owner_name || parcel.owner_client_code || "—"}</p>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="text-white/50">Surface</p>
          <p className="mt-1 font-semibold">{areaLabel}</p>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="text-white/50">Périmètre</p>
          <p className="mt-1 font-semibold">{perimeterLabel}</p>
        </div>
      </div>

      {geometryWarning ? (
        <div className="mt-5 rounded-2xl border border-mapgeo-sand/35 bg-mapgeo-sand/10 px-4 py-3 text-sm text-mapgeo-ivory">
          {geometryWarning}
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl bg-white/10 p-4">
        <p className="text-sm font-semibold">Sommets du polygone</p>
        <p className="mt-1 text-xs text-white/50">Coordonnées X/Y projetées en EPSG:32628</p>
        {!vertexRows.length ? <p className="mt-2 text-sm text-white/60">Aucune géométrie exploitable.</p> : null}
        <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
          {vertexRows.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span className="font-semibold">V{row.label}</span>
              <span className="text-white/75">X {Number(row.x).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} · Y {Number(row.y).toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
