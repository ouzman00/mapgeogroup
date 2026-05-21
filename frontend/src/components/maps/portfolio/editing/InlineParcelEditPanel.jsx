import { Redo2, Save, Trash2, Undo2, X } from "lucide-react";

import {
  computePerimeterFromPoints,
  formatArea,
  formatDistance,
  geometryAreaM2Projected,
  geometryToRings,
} from "../../../../utils/parcelGeometry";
import { DraggableMapPanel, PanelMoveHandle } from "../panels/MapFloatingPanels";

export default function InlineParcelEditPanel({
  activeFeature,
  form,
  setForm,
  geometry,
  saving,
  message,
  validationResult,
  deleteVertexMode,
  setDeleteVertexMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClose,
  onSave,
  canArchiveParcels = false,
  onDeleteParcel,
}) {
  if (!activeFeature) return null;
  const rings = geometryToRings(geometry);
  const vertexCount = rings.reduce((total, ring) => total + ring.length, 0);
  const area = geometryAreaM2Projected(geometry);
  const perimeter = rings.reduce((total, ring) => total + (computePerimeterFromPoints(ring) || 0), 0);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  return (
    <DraggableMapPanel
      className="mapgeo-mobile-tool-panel mapgeo-geometry-panel mapgeo-export-hidden mapgeo-panel-enter pointer-events-auto absolute bottom-3 left-3 right-3 top-auto z-[950] max-h-[55%] overflow-y-auto rounded-[20px] border border-white/10 bg-[#07111b]/94 p-3 text-white shadow-[0_24px_72px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:left-4 sm:right-auto sm:top-[92px] sm:bottom-auto sm:max-h-[calc(100%-260px)] sm:w-[320px] sm:max-w-[calc(100%-2rem)]"
      ariaLabel="Déplacer le panneau d’édition"
    >
      {({ dragHandleProps, resetPosition }) => (
        <>
          <PanelMoveHandle dragHandleProps={dragHandleProps} onReset={resetPosition} />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-mapgeo-sand/60">Édition active</p>
              <h3 className="mt-1 truncate text-base font-extrabold">{form.reference || activeFeature.parcel?.reference || "Parcelle"}</h3>
            </div>
            <button type="button" onClick={onClose} disabled={saving} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-45" title="Fermer l’édition">
              <X size={17} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
              <span className="block text-white/40">Surface</span>
              <strong className="text-sm">{area ? formatArea(area) : "—"}</strong>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
              <span className="block text-white/40">Périmètre</span>
              <strong className="text-sm">{perimeter ? formatDistance(perimeter) : "—"}</strong>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
              <span className="block text-white/40">Anneaux</span>
              <strong className="text-sm">{rings.length}</strong>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
              <span className="block text-white/40">Sommets</span>
              <strong className="text-sm">{vertexCount}</strong>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo || saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-xs font-extrabold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              title="Revenir à l’étape précédente (Ctrl/Cmd + Z)"
            >
              <Undo2 size={15} /> Retour
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo || saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-xs font-extrabold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              title="Rétablir l’étape suivante (Ctrl/Cmd + Y)"
            >
              <Redo2 size={15} /> Refaire
            </button>
          </div>

          {validationResult?.issues?.length ? (
            <div className={`mt-3 rounded-2xl border px-3 py-2 text-[11px] font-semibold leading-5 ${validationResult.status === "blocking" ? "border-mapgeo-sand/40 bg-mapgeo-sand/15 text-mapgeo-ivory" : validationResult.status === "warning" ? "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-ivory" : "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-ivory"}`}>
              <p className="mb-1 font-black uppercase tracking-[0.14em]">Contrôle géométrique</p>
              <ul className="list-disc space-y-1 pl-4">
                {validationResult.issues.slice(0, 3).map((entry) => (
                  <li key={`${entry.level}-${entry.code}`}>{entry.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 rounded-2xl border border-mapgeo-sand/30 bg-mapgeo-sand/10 px-3 py-2 text-[11px] font-semibold leading-4 text-mapgeo-ivory/85">
            Édition géométrique uniquement : déplacer les sommets, double-cliquer sur un segment pour en ajouter un, puis enregistrer.
          </div>

          <label className="mt-3 block text-[11px] font-bold text-white/60">
            Motif de modification géométrique
            <textarea
              value={form.geometry_change_reason}
              onChange={(event) => update("geometry_change_reason", event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.065] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60"
              placeholder="Ex. Correction terrain, import SIG vérifié, ajustement sommet…"
            />
          </label>

          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={() => setDeleteVertexMode((current) => !current)}
              disabled={!rings.length || saving}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                deleteVertexMode
                  ? "border-mapgeo-sand/50 bg-mapgeo-sand/20 text-mapgeo-ivory shadow-soft"
                  : "border-white/10 bg-white/[0.045] text-white/75 hover:bg-white/10"
              }`}
              title="Activer le mode suppression de sommet"
            >
              <Trash2 size={15} /> {deleteVertexMode ? "Suppression de sommet active" : "Effacer un sommet"}
            </button>
            {deleteVertexMode ? (
              <div className="rounded-2xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-[11px] font-semibold leading-4 text-mapgeo-ivory/80">
                Cliquez sur un sommet pour le supprimer. Sur ordinateur, tu peux aussi survoler un sommet puis appuyer sur Suppr ou Retour arrière. Minimum 3 sommets.
              </div>
            ) : null}
          </div>

          {canArchiveParcels ? (
            <div className="mt-3 rounded-2xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 p-2">
              <button
                type="button"
                onClick={onDeleteParcel}
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-mapgeo-sand/40 bg-mapgeo-sand/15 px-3 py-2.5 text-xs font-extrabold text-mapgeo-ivory transition hover:bg-mapgeo-sand/20 disabled:cursor-not-allowed disabled:opacity-45"
                title="Archiver cette parcelle sans supprimer ses données"
              >
                <Trash2 size={15} /> Archiver la parcelle
              </button>
            </div>
          ) : null}

          {message ? <p className="mt-3 rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory">{message}</p> : null}

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <button type="button" onClick={onSave} disabled={saving || !rings.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-mapgeo-primary px-3 py-2.5 text-sm font-extrabold text-white transition hover:bg-mapgeo-sand disabled:cursor-not-allowed disabled:opacity-55">
              <Save size={15} /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-white/10 px-3 py-2.5 text-sm font-bold text-white/70 transition hover:bg-white/10 disabled:opacity-55">
              Annuler
            </button>
          </div>
        </>
      )}
    </DraggableMapPanel>
  );
}
