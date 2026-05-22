import { memo } from "react";
function formatActiveMapFilters(filters = {}) {
  const labels = [];
  if (filters.owner_client_code) labels.push(`client ${filters.owner_client_code}`);
  if (filters.status) labels.push(`statut ${filters.status}`);
  if (filters.commune) labels.push(`commune ${filters.commune}`);
  if (filters.period) labels.push(`période ${filters.period}`);
  if (filters.q) labels.push(`recherche ${filters.q}`);
  return labels.join(" · ");
}

function ViewportSampleNotice({ summary }) {
  if (!summary?.bbox) return null;

  const loaded = Number(summary.loaded || 0);
  const total = Number(summary.total || loaded);
  const limit = Number(summary.limit || 500);
  const hasLimit = total > loaded || loaded >= limit;
  const filtersLabel = formatActiveMapFilters(summary.filters);

  return (
    <div className="mapgeo-viewport-notice mapgeo-export-hidden absolute left-1/2 top-3 z-[925] max-w-[min(720px,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#07111b]/78 px-3 py-2 text-xs font-semibold leading-5 text-white/78 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      Carte : emprise courante · {loaded.toLocaleString("fr-FR")} affichée{loaded > 1 ? "s" : ""}{Number.isFinite(total) && total !== loaded ? ` / ${total.toLocaleString("fr-FR")}` : ""}.
      {hasLimit ? ` Limite ${limit.toLocaleString("fr-FR")} atteinte : zoomez ou filtrez pour affiner.` : ""}
      {filtersLabel ? ` Filtres actifs : ${filtersLabel}.` : ""}
    </div>
  );
}

export default memo(ViewportSampleNotice);
