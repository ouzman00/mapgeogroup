import { FileText, History, Layers3, MapPinned, Ruler, Route } from "lucide-react";
import MapCanvas from "./MapCanvas";
import useParcelGeometry from "./hooks/useParcelGeometry";
import useParcelMapState from "./hooks/useParcelMapState";
import ParcelMetricsPanel from "./panels/ParcelMetricsPanel";
import ParcelDocumentsPanel from "./panels/ParcelDocumentsPanel";
import ParcelTimelinePanel from "./panels/ParcelTimelinePanel";
import ParcelLookupPanel from "./panels/ParcelLookupPanel";

function PanelTabButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
        active ? "bg-mapgeo-primary text-white" : "border border-mapgeo-line bg-white text-mapgeo-primary"
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

export default function ParcelMap({ parcel, sigLayers = [] }) {
  const geometry = useParcelGeometry(parcel);
  const mapState = useParcelMapState(sigLayers);

  const resetView = () => {
    if (!mapState.map) return;

    const boundsPoints = geometry.rings.flat();
    if (boundsPoints.length >= 3) {
      mapState.map.fitBounds(boundsPoints, { padding: [32, 32], maxZoom: 18 });
      return;
    }

    mapState.map.setView(geometry.center, 16);
  };

  const rightPanel = {
    documents: <ParcelDocumentsPanel documents={geometry.documents} />,
    timeline: <ParcelTimelinePanel timeline={geometry.timeline} />,
    lookup: <ParcelLookupPanel initialValues={geometry.lookupFields} />,
  }[mapState.activePanel];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#08131d] p-4 text-mapgeo-primary md:p-5 xl:p-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <ParcelMetricsPanel
          parcel={parcel}
          areaLabel={geometry.areaLabel}
          perimeterLabel={geometry.perimeterLabel}
          vertexRows={geometry.vertexRows}
          statusLabel={geometry.statusLabel}
          geometryWarning={geometry.geometryWarning}
        />

        <section className="flex min-h-[720px] min-w-0 flex-col rounded-[32px] border border-white/10 bg-[#0b1722] p-4 shadow-panel">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-mapgeo-sand/75">Carte centrale</p>
              <h2 className="mt-2 text-2xl font-bold text-white">{parcel.reference}</h2>
              <p className="mt-2 text-sm text-white/60">{parcel.location || parcel.commune || "Sans localisation"}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => mapState.setBaseLayer((current) => (current === "vector" ? "satellite" : "vector"))} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                <Layers3 size={16} className="mr-2 inline" /> {mapState.baseLayer === "vector" ? "Satellite" : "Vectoriel"}
              </button>
              <button type="button" onClick={() => mapState.setShowVertices((current) => !current)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                <MapPinned size={16} className="mr-2 inline" /> Sommets
              </button>
              <button type="button" onClick={() => mapState.setShowMeasurements((current) => !current)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                <Ruler size={16} className="mr-2 inline" /> Côtés
              </button>
              {mapState.hasExternalLayers ? (
                <button type="button" onClick={() => mapState.setShowExternalLayers((current) => !current)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                  <Route size={16} className="mr-2 inline" /> Couches SIG
                </button>
              ) : null}
              <button type="button" onClick={resetView} className="rounded-2xl bg-mapgeo-sand px-4 py-2.5 text-sm font-semibold text-mapgeo-primary">
                Recentrer
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <MapCanvas
              rings={geometry.rings}
              positions={geometry.leafletPositions}
              center={geometry.center}
              reference={parcel.reference}
              baseLayer={mapState.baseLayer}
              showVertices={mapState.showVertices}
              showMeasurements={mapState.showMeasurements}
              showExternalLayers={mapState.showExternalLayers}
              sigLayers={sigLayers}
              onMapReady={mapState.setMap}
            />
          </div>
        </section>

        <aside className="min-h-0 overflow-auto rounded-[32px] border border-mapgeo-line bg-white p-5 shadow-soft">
          <div className="flex flex-wrap gap-2">
            <PanelTabButton active={mapState.activePanel === "documents"} icon={FileText} label="Documents" onClick={() => mapState.setActivePanel("documents")} />
            <PanelTabButton active={mapState.activePanel === "timeline"} icon={History} label="Jalons" onClick={() => mapState.setActivePanel("timeline")} />
            <PanelTabButton active={mapState.activePanel === "lookup"} icon={Layers3} label="Recherche" onClick={() => mapState.setActivePanel("lookup")} />
          </div>

          <div className="mt-5">{rightPanel}</div>
        </aside>
      </div>
    </div>
  );
}
