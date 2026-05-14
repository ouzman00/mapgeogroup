import { AlertTriangle, Eye, EyeOff, LocateFixed, Loader2, SlidersHorizontal, X } from "lucide-react";

function stopPanelEvent(event) {
  event?.stopPropagation?.();
}

const GROUP_LABELS = {
  fonds: "Fonds de carte",
  parcelles: "Parcelles",
  cadastre: "Cadastre",
  zonage: "Zonage",
  risques: "Risques",
  reseaux: "Réseaux",
  contexte: "Contexte",
  relief: "Relief / MNT",
  documents: "Documents",
  privees: "Couches privées",
};

function isLayerReady(layer = {}) {
  return !layer.processing_status || layer.processing_status === "ready";
}

function canActivateLayer(layer = {}) {
  return layer.available !== false && isLayerReady(layer);
}

function privateLayerGroupId(layer = {}) {
  if (!layer.privateLayer) return layer.group || "autres";
  if (["fonds", "relief"].includes(layer.group)) return layer.group;
  return "privees";
}

function groupVisibleLayers(layers = []) {
  return layers.reduce((groups, layer) => {
    const groupId = privateLayerGroupId(layer);
    if (!groups[groupId]) groups[groupId] = [];
    groups[groupId].push(layer);
    return groups;
  }, {});
}

function layerUnavailableMessage(layer = {}) {
  if (layer.available === false) return layer.displayMessage || layer.display_message || "Couche indisponible ou non prête.";
  if (!isLayerReady(layer)) return layer.displayMessage || layer.display_message || "Couche en préparation, non activable pour le moment.";
  return "";
}

function LayerToggle({ layer, onToggle, onOpacityChange, onZoomToLayer }) {
  const disabled = !canActivateLayer(layer);
  const canAdjustOpacity = layer.type !== "feature" && !disabled;
  const canZoom = Boolean(layer.extent || layer.id === "parcels-portfolio") && !disabled;
  const visibleButOutOfZoom = layer.visible && !layer.zoomVisible;
  const unavailableMessage = layerUnavailableMessage(layer);

  function handleToggle() {
    if (disabled) return;
    onToggle(layer.id);
  }

  return (
    <article className={`rounded-2xl border border-white/10 bg-white/[0.045] p-3 transition ${disabled ? "opacity-65" : "hover:bg-white/[0.07]"}`}>
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={handleToggle} disabled={disabled} className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-not-allowed">
          <span
            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${
              layer.visible ? "border-mapgeo-sand/40 bg-mapgeo-primary text-white" : "border-white/10 bg-white/[0.045] text-white/50"
            }`}
          >
            {layer.error ? <AlertTriangle size={17} /> : layer.loading ? <Loader2 size={17} className="animate-spin" /> : layer.visible ? <Eye size={17} /> : <EyeOff size={17} />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-extrabold text-white/90">{layer.name}</span>
            <span className="mt-0.5 block text-xs font-medium text-white/50">
              {unavailableMessage || (layer.error ? layer.error : layer.loading ? "Préparation…" : layer.visible ? "Affichée" : "Masquée")}{visibleButOutOfZoom ? " · hors niveau de zoom" : ""}
            </span>
            {layer.privateLayer ? <span className="mt-1 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white/45">Couche privée</span> : null}
          </span>
        </button>

        {canZoom ? (
          <button
            type="button"
            onClick={() => onZoomToLayer(layer)}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
            title="Centrer la carte sur cette couche"
          >
            <LocateFixed size={14} /> Centrer
          </button>
        ) : null}
      </div>

      {canAdjustOpacity ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2">
          <div className="mb-1 flex justify-between text-xs font-semibold text-white/50">
            <span>Opacité</span>
            <span>{Math.round((layer.opacity ?? 1) * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round((layer.opacity ?? 1) * 100)}
            onChange={(event) => onOpacityChange(layer.id, Number(event.target.value) / 100)}
            className="mapgeo-range w-full"
          />
        </div>
      ) : null}
    </article>
  );
}

export default function LayerManagerPanel({
  open,
  layers,
  onClose,
  onToggle,
  onOpacityChange,
  onZoomToLayer,
}) {
  if (!open) return null;

  const groupedLayers = groupVisibleLayers(layers);
  const groupIds = Object.keys(groupedLayers).filter((groupId) => groupedLayers[groupId].length > 0);
  const activeCount = layers.filter((layer) => layer.visible && canActivateLayer(layer)).length;
  const privateLayers = layers.filter((layer) => layer.privateLayer);
  const availablePrivateLayers = privateLayers.filter(canActivateLayer);

  return (
    <div
      className="absolute right-4 top-4 z-[1000] flex max-h-[calc(100%-2rem)] w-[380px] max-w-[calc(100%-2rem)] flex-col rounded-[24px] border border-white/10 bg-[#07111b]/96 text-white shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl"
      onPointerDown={stopPanelEvent}
      onMouseDown={stopPanelEvent}
      onClick={stopPanelEvent}
      onDoubleClick={stopPanelEvent}
      onContextMenu={stopPanelEvent}
    >
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-mapgeo-sand/70">
            <SlidersHorizontal size={14} /> Gestion
          </p>
          <h3 className="mt-1 text-xl font-extrabold tracking-tight">Couches utiles</h3>
          <p className="mt-1 text-xs font-semibold text-white/50">{activeCount}/{layers.length} couche{layers.length > 1 ? "s" : ""} active{activeCount > 1 ? "s" : ""}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-white/10 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {privateLayers.length && !availablePrivateLayers.length ? (
          <div className="mb-4 rounded-2xl border border-mapgeo-sand/25 bg-mapgeo-sand/10 p-3 text-xs font-semibold leading-5 text-mapgeo-sand/90">
            Aucune couche privée prête n’est disponible. Les couches en attente, en traitement ou en échec restent désactivées sur la carte.
          </div>
        ) : null}
        {groupIds.length ? (
          <div className="space-y-5">
            {groupIds.map((groupId) => (
              <section key={groupId}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-extrabold text-white/80">{GROUP_LABELS[groupId] || "Autres couches"}</h4>
                  <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-bold text-white/50">
                    {groupedLayers[groupId].filter((layer) => layer.visible && canActivateLayer(layer)).length}/{groupedLayers[groupId].length}
                  </span>
                </div>
                <div className="space-y-2">
                  {groupedLayers[groupId].map((layer) => (
                    <LayerToggle
                      key={layer.id}
                      layer={layer}
                      onToggle={onToggle}
                      onOpacityChange={onOpacityChange}
                      onZoomToLayer={onZoomToLayer}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm font-semibold leading-6 text-white/60">
            Aucune couche opérationnelle n’est disponible pour cette carte.
          </div>
        )}
      </div>
    </div>
  );
}
