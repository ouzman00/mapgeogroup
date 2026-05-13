import {Check, ChevronLeft, ChevronRight, FileDown, Info, Layers3, Map as MapIcon, Pencil, Ruler, Tags, Eye} from "lucide-react";

function stopLeafletPropagation(event) {
  event?.stopPropagation?.();
  if (event?.nativeEvent) {
    event.nativeEvent.stopPropagation?.();
    event.nativeEvent.stopImmediatePropagation?.();
  }
}

function ToolbarButton({ active = false, icon: Icon, label, onClick, disabled = false, title, forceLabel = false, className = "", iconOnly = false }) {
  const labelClassName = iconOnly ? "sr-only" : forceLabel ? "hidden md:inline" : "hidden xl:inline";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-bold mapgeo-action-button disabled:cursor-not-allowed disabled:opacity-45 ${
        active ? "is-active bg-mapgeo-primary text-white shadow-soft" : "text-white/80 hover:bg-white/[0.08] hover:text-white"
      } ${className}`}
    >
      <Icon size={17} />
      <span className={labelClassName}>{label}</span>
    </button>
  );
}

function ToolbarArrowButton({ open, onClick }) {
  const Icon = open ? ChevronLeft : ChevronRight;
  const label = open ? "Masquer les outils" : "Afficher les outils";

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      className="mapgeo-action-button group grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white active:border-mapgeo-sand/60 active:bg-mapgeo-primary active:text-white"
    >
      <Icon size={18} className={`transition-transform duration-200 ${open ? "group-hover:-translate-x-0.5" : "group-hover:translate-x-0.5"}`} />
    </button>
  );
}

function getBaseName(layer) {
  if (layer?.shortName) return layer.shortName;
  if (layer?.id === "base-plan") return "Plan";
  if (layer?.id === "base-satellite") return "Satellite";
  if (layer?.id === "base-hybrid") return "Hybride";
  if (layer?.id === "base-relief") return "OSM";
  return layer?.name || "Fond";
}

function thumbnailClass(layer) {
  if (layer?.id === "base-satellite" || layer?.id === "base-hybrid") {
    return "bg-[radial-gradient(circle_at_22%_26%,rgba(132,204,22,.52),transparent_18%),radial-gradient(circle_at_68%_70%,rgba(120,113,108,.65),transparent_22%),linear-gradient(135deg,#334155,#52525b_48%,#123B5D)]";
  }
  if (layer?.id === "base-relief") {
    return "bg-[linear-gradient(90deg,rgba(34,197,94,.20)_1px,transparent_1px),linear-gradient(0deg,rgba(59,130,246,.18)_1px,transparent_1px),radial-gradient(circle_at_28%_32%,rgba(34,197,94,.35),transparent_22%),#F7F5F2] bg-[length:14px_14px]";
  }
  return "bg-[linear-gradient(90deg,rgba(148,163,184,.25)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,.25)_1px,transparent_1px),#F7F5F2] bg-[length:16px_16px]";
}


const CARTOGRAPHY_DISPLAY_MODES = [
  {
    id: "cadastre",
    label: "Cadastre",
    title: "Parcelles prioritaires",
    description: "Contours parcelles très lisibles, couches d’analyse légèrement atténuées.",
  },
  {
    id: "analyse",
    label: "Analyse",
    title: "Analyse couches",
    description: "Couches importées prioritaires, parcelles en référence discrète.",
  },
  {
    id: "edition",
    label: "Édition",
    title: "Édition terrain",
    description: "Parcelle active, sommets et mesures plus visibles.",
  },
];

function DisplayModePicker({ value = "cadastre", onChange }) {
  return (
    <div className="mapgeo-mobile-tool-panel mapgeo-display-mode-panel mapgeo-popover-enter mt-2 w-full max-w-[calc(100vw-1.5rem)] rounded-[16px] border border-white/10 bg-[#07111b]/96 p-2.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:w-[420px] sm:max-w-[calc(100vw-2rem)]">
      <div className="mb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Mode d’affichage</p>
        <h3 className="text-sm font-extrabold text-white">Hiérarchie cartographique</h3>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {CARTOGRAPHY_DISPLAY_MODES.map((mode) => {
          const active = mode.id === value;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onChange?.(mode.id)}
              className={`mapgeo-action-button rounded-xl border p-3 text-left transition ${active ? "border-mapgeo-sand bg-mapgeo-sand/12 text-white" : "border-white/10 bg-white/[0.035] text-white/72 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"}`}
            >
              <span className="block text-xs font-black uppercase tracking-[0.12em]">{mode.label}</span>
              <span className="mt-1 block text-[11px] font-bold leading-4 text-white/55">{mode.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BaseMapPicker({ layers, activeBaseLayerId, onBaseSelect }) {
  const visibleLayers = Array.isArray(layers) && layers.length ? layers : [];

  return (
    <div className="mapgeo-mobile-tool-panel mapgeo-basemap-panel mapgeo-popover-enter mt-2 w-full max-w-[calc(100vw-1.5rem)] rounded-[16px] sm:w-[460px] sm:max-w-[calc(100vw-2rem)] border border-white/10 bg-[#07111b]/96 p-2.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/60">Fond de carte</h3>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {visibleLayers.map((layer) => {
          const active = layer.id === activeBaseLayerId;
          return (
            <button key={layer.id} type="button" onClick={() => onBaseSelect(layer.id)} className={`group mapgeo-action-button rounded-xl border px-2 py-1.5 text-center ${active ? "border-mapgeo-sand bg-mapgeo-sand/10" : "border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.06]"}`}>
              <span className={`relative block h-[34px] overflow-hidden rounded-lg border ${active ? "border-mapgeo-sand/60" : "border-white/10"} ${thumbnailClass(layer)}`}>
                {active ? (
                  <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-mapgeo-primary text-white shadow-lg">
                    <Check size={11} />
                  </span>
                ) : null}
              </span>
              <span className={`mt-1 block truncate text-[11px] font-extrabold ${active ? "text-white" : "text-white/70"}`}>{getBaseName(layer)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FloatingMapToolbar({
  activeCommand,
  activeBaseLayerId,
  baseLayers,
  showLegend,
  showLabels,
  showMeasurements,
  showVertices,
  inlineEditActive,
  activeFeature,
  cartographyDisplayMode = "cadastre",
  setCartographyDisplayMode,
  canManageParcels = false,
  onBaseSelect,
  setActiveCommand,
  setShowLegend,
  setShowLabels,
  setShowMeasurements,
  setShowVertices,
  onStartEdit,
  onOpenExportOptions,
  onExportPng,
  onExportJpeg,
  onExportGeoJson,
}) {
  const overlayEventProps = {
    onPointerDown: stopLeafletPropagation,
    onMouseDown: stopLeafletPropagation,
    onClick: stopLeafletPropagation,
    onDoubleClick: stopLeafletPropagation,
    onContextMenu: stopLeafletPropagation,
  };

  const commonButtonClass = "h-10 min-w-10 px-2.5 md:h-auto md:min-w-0 md:px-3";
  const compactToolButtonClass = "h-10 min-w-10 px-0 md:w-auto md:px-3";
  const toolsCommands = ["tools", "base", "display", "export"];
  const toolsOpen = toolsCommands.includes(activeCommand);
  const verticesDisabled = !activeFeature?.rings?.length;
  const toggleTools = () => {
    setActiveCommand((current) => (toolsCommands.includes(current) ? null : "tools"));
  };

  return (
    <div {...overlayEventProps} className={`mapgeo-toolbar-container ${toolsOpen ? "is-expanded" : "is-collapsed"} mapgeo-export-hidden absolute left-3 right-3 top-3 z-[970] max-w-[calc(100%-1.5rem)] sm:left-4 sm:right-auto sm:top-4 sm:max-w-[calc(100%-2rem)]`}>
      <div className="mapgeo-toolbar-shell flex w-full max-w-full items-center gap-1 overflow-hidden rounded-[18px] border border-white/10 bg-[#07111b]/70 p-1.5 text-white shadow-[0_20px_64px_rgba(0,0,0,0.26)] backdrop-blur-xl sm:w-fit sm:min-w-0">
        <ToolbarButton active={showLegend} icon={Layers3} label="Légende" forceLabel className={commonButtonClass} onClick={() => {
            setActiveCommand("tools");
            setShowMeasurements(false);
            setShowVertices(false);
            setShowLegend((current) => !current);
          }} />
        <ToolbarArrowButton open={toolsOpen} onClick={toggleTools} />

        {toolsOpen ? (
          <>
            <span aria-hidden="true" className="mx-1 h-7 w-px shrink-0 bg-white/10" />
            <div className="mapgeo-inline-tools flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden pr-1 sm:max-w-[calc(100vw-10rem)] md:max-w-[calc(100vw-13rem)]" aria-label="Outils de la carte">
              <ToolbarButton active={showLabels} icon={Tags} label="Libellés" forceLabel className={compactToolButtonClass} title="Libellés" onClick={() => { setActiveCommand("tools"); setShowLabels?.((current) => !current); }} />
              <ToolbarButton active={activeCommand === "display"} icon={Eye} label="Mode" forceLabel className={compactToolButtonClass} title="Mode d’affichage" onClick={() => {
                    setShowLegend(false);
                    setShowMeasurements(false);
                    setShowVertices(false);
                    setActiveCommand((current) => (current === "display" ? "tools" : "display"));
                  }} />
              <ToolbarButton active={activeCommand === "base"} icon={MapIcon} label="Fond de carte" forceLabel className={compactToolButtonClass} title="Fond de carte" onClick={() => {
                    setShowLegend(false);
                    setShowMeasurements(false);
                    setShowVertices(false);
                    setActiveCommand((current) => (current === "base" ? "tools" : "base"));
                  }} />
              {canManageParcels ? (
                <ToolbarButton
                  active={inlineEditActive}
                  icon={Pencil}
                  label="Géométrie"
                  forceLabel
                  className={compactToolButtonClass}
                  title={!activeFeature ? "Sélectionnez une parcelle pour éditer sa géométrie" : inlineEditActive ? "Fermer l'édition géométrique" : "Éditer la géométrie de la parcelle sélectionnée"}
                  disabled={!activeFeature}
                  onClick={() => {
                    setActiveCommand("tools");
                    setShowMeasurements(false);
                    setShowVertices(false);
                    onStartEdit?.();
                  }}
                />
              ) : null}
              <ToolbarButton active={showMeasurements} icon={Ruler} label="Mesures" forceLabel className={compactToolButtonClass} title="Mesures" onClick={() => {
                  setShowLegend(false);
                  setShowVertices(false);
                  setActiveCommand("tools");
                  setShowMeasurements((current) => !current);
                }} />
              
              <ToolbarButton
                active={showVertices && !verticesDisabled}
                icon={Info}
                label="Sommets"
                forceLabel
                className={compactToolButtonClass}
                title={verticesDisabled ? "Sélectionnez une parcelle avec géométrie" : "Sommets"}
                disabled={verticesDisabled}
                onClick={() => {
                  if (verticesDisabled) return;
                  setActiveCommand("tools");
                  setShowVertices((current) => !current);
                }}
              />
              <ToolbarButton active={activeCommand === "export"} icon={FileDown} label="Exporter" forceLabel className={compactToolButtonClass} title="Exporter" onClick={() => {
                  setShowLegend(false);
                  setShowMeasurements(false);
                  setShowVertices(false);
                  setActiveCommand((current) => (current === "export" ? null : "export"));
                }} />
            </div>
          </>
        ) : null}
      </div>
      {activeCommand === "base" ? (
        <BaseMapPicker layers={baseLayers} activeBaseLayerId={activeBaseLayerId} onBaseSelect={(layerId) => { onBaseSelect(layerId); setActiveCommand("tools"); }} />
      ) : null}

      {activeCommand === "display" ? (
        <DisplayModePicker value={cartographyDisplayMode} onChange={(mode) => { setCartographyDisplayMode?.(mode); setActiveCommand("tools"); }} />
      ) : null}

      {activeCommand === "export" ? (
        <div className="mapgeo-mobile-tool-panel mapgeo-export-panel mapgeo-popover-enter mt-2 w-full max-w-[calc(100vw-1.5rem)] rounded-[16px] sm:w-[300px] sm:max-w-[calc(100vw-2rem)] border border-white/10 bg-[#07111b]/96 p-3 text-white shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <div className="border-b border-white/10 pb-2">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Exporter</p>
            <h3 className="truncate text-sm font-extrabold text-white">Carte et géométrie</h3>
          </div>
          <p className="mt-2 text-xs leading-5 text-white/60">Choisissez un format.</p>
          <button type="button" onClick={() => { setActiveCommand(null); onOpenExportOptions?.(); }} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-mapgeo-primary px-3 py-2.5 text-sm font-extrabold text-white mapgeo-action-button hover:bg-mapgeo-sand">
            <FileDown size={15} /> Assistant d’export
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={onExportPng} className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-bold text-white/70 mapgeo-action-button hover:bg-white/10">PNG</button>
            <button type="button" onClick={onExportJpeg} className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-bold text-white/70 mapgeo-action-button hover:bg-white/10">JPEG</button>
            <button type="button" onClick={onExportGeoJson} disabled={!activeFeature?.parcel?.geometry} className="col-span-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-bold text-white/70 mapgeo-action-button hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45">GeoJSON parcelle</button>
          </div>
          {!activeFeature?.parcel?.geometry ? (
            <p className="mt-2 rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory">GeoJSON indisponible : aucune géométrie sur la parcelle sélectionnée.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
