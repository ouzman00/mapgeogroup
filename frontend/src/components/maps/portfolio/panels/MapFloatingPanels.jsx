import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, Ruler, Trash2, Undo2, X } from "lucide-react";

function stopLeafletPropagation(event) {
  event?.stopPropagation?.();
  event?.nativeEvent?.stopImmediatePropagation?.();
}

function DraggableMapPanel({ children, className, initialOffset = { x: 0, y: 0 }, ariaLabel = "Déplacer le panneau" }) {
  const panelRef = useRef(null);
  const dragStateRef = useRef(null);
  const [offset, setOffset] = useState(initialOffset);

  const getSafeOffset = useCallback((nextOffset) => {
    if (typeof window === "undefined") return nextOffset;
    const panel = panelRef.current;
    if (!panel) return nextOffset;

    const rect = panel.getBoundingClientRect();
    const margin = 12;
    const minX = margin - rect.left + offset.x;
    const maxX = window.innerWidth - margin - rect.right + offset.x;
    const minY = margin - rect.top + offset.y;
    const maxY = window.innerHeight - margin - rect.bottom + offset.y;

    return {
      x: Math.min(Math.max(nextOffset.x, minX), maxX),
      y: Math.min(Math.max(nextOffset.y, minY), maxY),
    };
  }, [offset.x, offset.y]);

  const stopPanelEvent = (event) => stopLeafletPropagation(event);
  const resetPosition = useCallback(() => setOffset(initialOffset), [initialOffset]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      event.preventDefault?.();
      stopLeafletPropagation(event);
      setOffset(getSafeOffset({
        x: dragState.origin.x + event.clientX - dragState.startX,
        y: dragState.origin.y + event.clientY - dragState.startY,
      }));
    };

    const stopDragging = (event) => {
      if (!dragStateRef.current || (event?.pointerId !== undefined && dragStateRef.current.pointerId !== event.pointerId)) return;
      stopLeafletPropagation(event);
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [getSafeOffset]);

  useEffect(() => {
    const keepPanelVisible = () => setOffset((current) => getSafeOffset(current));
    window.addEventListener("resize", keepPanelVisible);
    return () => window.removeEventListener("resize", keepPanelVisible);
  }, [getSafeOffset]);

  const moveByKeyboard = (event) => {
    const step = event.shiftKey ? 32 : 12;
    const deltas = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };

    if (event.key === "Escape") {
      event.preventDefault?.();
      resetPosition();
      return;
    }

    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault?.();
    setOffset((current) => getSafeOffset({ x: current.x + delta.x, y: current.y + delta.y }));
  };

  const dragHandleProps = {
    role: "button",
    tabIndex: 0,
    "aria-label": ariaLabel,
    onPointerDown: (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault?.();
      stopLeafletPropagation(event);
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: offset,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerUp: (event) => {
      if (dragStateRef.current?.pointerId === event.pointerId) {
        stopLeafletPropagation(event);
        dragStateRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    onPointerCancel: () => {
      dragStateRef.current = null;
    },
    onKeyDown: moveByKeyboard,
    style: { touchAction: "none", userSelect: "none" },
  };

  return (
    <div
      ref={panelRef}
      className={className}
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      onPointerDown={stopPanelEvent}
      onMouseDown={stopPanelEvent}
      onClick={stopPanelEvent}
      onDoubleClick={stopPanelEvent}
      onContextMenu={stopPanelEvent}
    >
      {typeof children === "function" ? children({ dragHandleProps, resetPosition }) : children}
    </div>
  );
}

function PanelMoveHandle({ dragHandleProps, onReset, onClose, closeLabel = "Fermer" }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
      <button
        type="button"
        {...dragHandleProps}
        className="inline-flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-xl px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:bg-white/[0.06] active:cursor-grabbing"
        title="Déplacer le panneau"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white/26" />
        Déplacer
      </button>
      <button type="button" onClick={onReset} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white" title="Réinitialiser la position">
        <Undo2 size={13} />
      </button>
      {onClose ? (
        <button type="button" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white" title={closeLabel}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}


function MeasurementToolPanel({ open, map, measurementDraft, measurementDraftSummary, isMobileMeasurePanel, setMeasurementDraft, onClose, onFinish }) {
  if (!open) return null;

  const draftSummary = measurementDraftSummary;

  const setMode = (mode) => setMeasurementDraft((current) => ({
    mode,
    points: current?.mode === mode ? current.points : [],
    cursorPoint: null,
    snapPoint: null,
    snapKind: null,
    finished: false,
  }));

  const addPointFromCenter = () => {
    if (!map) return;

    const center = map.getCenter();
    setMeasurementDraft((current) => ({
      mode: current?.mode || "distance",
      points: [...(current?.points || []), [center.lat, center.lng]],
      cursorPoint: null,
      snapPoint: null,
      snapKind: null,
      finished: false,
    }));
  };

  const undoPoint = () => setMeasurementDraft((current) => ({
    ...current,
    points: (current?.points || []).slice(0, -1),
    cursorPoint: null,
    snapPoint: null,
    snapKind: null,
    finished: false,
  }));

  const resetPoints = () => setMeasurementDraft((current) => ({
    ...current,
    points: [],
    cursorPoint: null,
    snapPoint: null,
    snapKind: null,
    finished: false,
  }));

  const pointCount = measurementDraft?.points?.length || 0;

  return (
    <>
      {isMobileMeasurePanel ? (
        <div className="mapgeo-measure-center-reticle" aria-hidden="true">
          <span />
        </div>
      ) : null}

      <DraggableMapPanel
        className="mapgeo-mobile-tool-panel mapgeo-measure-panel mapgeo-export-hidden mapgeo-panel-enter absolute bottom-3 left-3 right-3 top-auto z-[950] max-h-[45%] overflow-y-auto rounded-[18px] border border-white/10 bg-[#07111b]/96 p-3 text-white shadow-[0_22px_68px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:left-auto sm:right-4 sm:top-24 sm:bottom-auto sm:w-[300px] sm:max-w-[calc(100%-2rem)] sm:max-h-[calc(100%-160px)]"
        ariaLabel="Déplacer le bloc Mesures"
      >
        {({ dragHandleProps, resetPosition }) => (
          <>
            <PanelMoveHandle dragHandleProps={dragHandleProps} onReset={resetPosition} onClose={onClose} closeLabel="Fermer les mesures" />

            <div className="mapgeo-mobile-measure-header flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Ruler size={16} className="text-mapgeo-sand" />
                <h3 className="truncate text-sm font-extrabold">Mesurer</h3>
              </div>
              <span className="rounded-full bg-mapgeo-sand/20 px-2 py-0.5 text-[10px] font-bold text-mapgeo-sand">
                {pointCount} pt{pointCount > 1 ? "s" : ""}
              </span>
            </div>

            <p className="mapgeo-measure-help mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold leading-5 text-white/55">
              {isMobileMeasurePanel
                ? "Touchez la carte pour placer un point, ou utilisez Ajouter au centre si vous preferez viser avec le reticule."
                : "Cliquez directement sur la carte pour placer les points. Double-cliquez ou utilisez Terminer pour valider."}
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("distance")} className={`rounded-xl px-3 py-2 text-xs font-extrabold transition ${measurementDraft.mode === "distance" ? "bg-mapgeo-primary text-white" : "bg-white/[0.055] text-white/70 hover:bg-white/10"}`}>
                Distance
              </button>
              <button type="button" onClick={() => setMode("surface")} className={`rounded-xl px-3 py-2 text-xs font-extrabold transition ${measurementDraft.mode === "surface" ? "bg-mapgeo-primary text-white" : "bg-white/[0.055] text-white/70 hover:bg-white/10"}`}>
                Surface
              </button>
            </div>

            <div className="mt-2 grid gap-1.5">
              <div className="mapgeo-measure-result-row flex justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-1.5">
                <span className="text-white/60">Distance</span>
                <strong className="text-right text-white">{draftSummary.distanceLabel}</strong>
              </div>
              <div className="mapgeo-measure-result-row flex justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-1.5">
                <span className="text-white/60">Surface</span>
                <strong className="text-right text-white">{draftSummary.surfaceLabel}</strong>
              </div>
              <div className="mapgeo-measure-result-row flex justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-1.5">
                <span className="text-white/60">Périmètre</span>
                <strong className="text-right text-white">{draftSummary.perimeterLabel}</strong>
              </div>
            </div>

            {/* Instruction visible UNIQUEMENT en desktop : guidance simple */}
            <p className="mapgeo-measure-desktop-hint mt-2 hidden md:block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/55">
              Cliquez sur la carte pour placer un point. Double-clic ou bouton « Terminer » pour valider.
            </p>

            <div className="mapgeo-measure-actions mt-2 flex flex-wrap gap-2">
              {/* Bouton "Ajouter au centre" : MOBILE UNIQUEMENT (replication du reticule central).
                  En desktop, l utilisateur clique directement sur la carte. */}
              <button type="button" onClick={addPointFromCenter} className="mapgeo-measure-center-btn md:hidden inline-flex items-center gap-2 rounded-xl border border-mapgeo-sand/40 bg-mapgeo-sand/15 px-3 py-2 text-xs font-bold text-mapgeo-ivory hover:bg-mapgeo-sand/25">
                <Plus size={14} /> Ajouter au centre
              </button>
              <button type="button" onClick={onFinish} disabled={!pointCount} className="inline-flex items-center gap-2 rounded-xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-3 py-2 text-xs font-bold text-mapgeo-ivory hover:bg-mapgeo-sand/20 disabled:cursor-not-allowed disabled:opacity-35">
                <Check size={14} /> Terminer
              </button>
              <button type="button" onClick={undoPoint} disabled={!pointCount} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35">
                <Undo2 size={14} /> Annuler
              </button>
              <button type="button" onClick={resetPoints} disabled={!pointCount} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35">
                <Trash2 size={14} /> Vider
              </button>
            </div>
          </>
        )}
      </DraggableMapPanel>
    </>
  );
}


function VertexToolPanel({ open, activeFeature, measurementSummary, displayOptions = DEFAULT_VERTEX_DISPLAY_OPTIONS, onToggleDisplay, onClose, shiftLeft = false }) {
  if (!open) return null;

  const hasGeometry = Boolean(activeFeature?.rings?.length);
  const rows = [
    { key: "sommets", label: "Sommets", value: measurementSummary?.vertexCount || 0 },
    { key: "dimensions", label: "Dimensions", value: measurementSummary?.sideCount ? `${measurementSummary.sideCount} côtés` : "—" },
  ];

  return (
    <DraggableMapPanel
      className="mapgeo-mobile-tool-panel mapgeo-vertices-panel mapgeo-export-hidden mapgeo-panel-enter absolute bottom-3 left-3 right-3 top-auto z-[949] max-h-[45%] overflow-y-auto rounded-[18px] border border-white/10 bg-[#07111b]/96 p-3 text-white shadow-[0_22px_68px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:left-auto sm:right-4 sm:top-24 sm:bottom-auto sm:w-[270px] sm:max-w-[calc(100%-2rem)] sm:max-h-[calc(100%-160px)]"
      initialOffset={shiftLeft ? { x: -316, y: 0 } : { x: 0, y: 0 }}
      ariaLabel="Déplacer le bloc Sommets"
    >
      {({ dragHandleProps, resetPosition }) => (
        <>
          <PanelMoveHandle dragHandleProps={dragHandleProps} onReset={resetPosition} onClose={onClose} closeLabel="Fermer les sommets" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Info size={16} className="text-mapgeo-sand" />
              <h3 className="truncate text-sm font-extrabold">Sommets</h3>
            </div>
            <span className="rounded-full bg-mapgeo-sand/20 px-2 py-0.5 text-[10px] font-bold text-mapgeo-sand">Actif</span>
          </div>
          {hasGeometry ? (
            <>
              <div className="mt-2 grid gap-1.5 text-sm">
                {rows.map((row) => {
                  const active = displayOptions[row.key] !== false;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => onToggleDisplay?.(row.key)}
                      className={`flex justify-between gap-3 rounded-xl border px-3 py-1.5 text-left transition ${active ? "border-mapgeo-sand/40 bg-white/[0.075] text-white" : "border-white/10 bg-white/[0.025] text-white/40"}`}
                      aria-pressed={active}
                      title={active ? `Masquer ${row.label.toLowerCase()}` : `Afficher ${row.label.toLowerCase()}`}
                    >
                      <span className="text-white/60">{row.label}</span>
                      <strong className="text-right text-white">{row.value}</strong>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold leading-5 text-white/50">
Activez les éléments à afficher sur la carte.
              </p>
            </>
          ) : (
            <p className="mt-2 rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory">
              Sélectionnez une parcelle contenant un polygone.
            </p>
          )}
        </>
      )}
    </DraggableMapPanel>
  );
}

export default function MapToolFeedbackPanel({ map, showMeasurements, showVertices, activeFeature, measurementSummary, measurementDraft, measurementDraftSummary, isMobileMeasurePanel, setMeasurementDraft, setShowMeasurements, setShowVertices, vertexDisplayOptions, onToggleVertexDisplay, onFinishMeasurement }) {
  if (!showMeasurements && !showVertices) return null;

  return (
    <>
      <MeasurementToolPanel
        open={showMeasurements}
        map={map}
        measurementDraft={measurementDraft}
        measurementDraftSummary={measurementDraftSummary}
        isMobileMeasurePanel={isMobileMeasurePanel}
        setMeasurementDraft={setMeasurementDraft}
        onClose={() => setShowMeasurements(false)}
        onFinish={onFinishMeasurement}
      />
      <VertexToolPanel
        key={showMeasurements ? "vertices-with-measure" : "vertices-only"}
        open={showVertices}
        activeFeature={activeFeature}
        measurementSummary={measurementSummary}
        displayOptions={vertexDisplayOptions}
        onToggleDisplay={onToggleVertexDisplay}
        onClose={() => setShowVertices(false)}
        shiftLeft={showMeasurements}
      />
    </>
  );
}

