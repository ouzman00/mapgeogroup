import { Download, FileCode2, FileDown, Image, Printer, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { exportGeometryAsGeoJson, exportProfessionalMapImage, exportProfessionalMapPdf, safeFileName } from "./mapExport";
import { buildParcelAttributeRows } from "./ParcelAttributeSheet";
import { getAvailableLegendItems } from "../parcelMapStyles";
import { parcelToGeoJsonFeature } from "../../../utils/parcelGeoJson";

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-mapgeo-secondary/50">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs leading-5 text-mapgeo-secondary/60">{hint}</span> : null}
    </label>
  );
}

function inputClass() {
  return "w-full rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-semibold text-mapgeo-primary outline-none focus:border-mapgeo-primary";
}

function Toggle({ checked, label, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-semibold text-mapgeo-primary">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-mapgeo-primary" />
    </label>
  );
}

function FormatButton({ active, icon: Icon, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active ? "border-mapgeo-primary bg-mapgeo-primary text-white shadow-soft" : "border-mapgeo-line bg-white text-mapgeo-primary hover:bg-mapgeo-ivory"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-extrabold"><Icon size={17} /> {title}</div>
      <p className={`mt-1 text-xs leading-5 ${active ? "text-white/80" : "text-mapgeo-secondary/60"}`}>{subtitle}</p>
    </button>
  );
}

function buildGeoJsonFeature(activeFeature) {
  if (!activeFeature?.parcel?.geometry) return null;
  return activeFeature.geojson || parcelToGeoJsonFeature({
    ...activeFeature.parcel,
    area_label: activeFeature.areaLabel,
    perimeter_label: activeFeature.perimeterLabel,
  });
}

export default function PrintMapDialog({ open, onClose, mapContainerRef, activeFeature, activeLayers = [], author = "" }) {
  const defaultTitle = activeFeature?.parcel?.reference ? `Plan parcellaire · ${activeFeature.parcel.reference}` : "Plan parcellaire";
  const [options, setOptions] = useState({
    outputFormat: "pdf",
    title: defaultTitle,
    fileName: safeFileName(defaultTitle),
    format: "a4",
    orientation: "landscape",
    scale: "Échelle graphique",
    resolutionScale: 2,
    professionalLayout: true,
    includeTitle: true,
    includeLegend: true,
    includeNorth: true,
    includeScale: true,
    includeDate: true,
    includeReference: true,
    includeSummary: true,
    useSavePicker: false,
    author: author || "",
  });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextTitle = activeFeature?.parcel?.reference ? `Plan parcellaire · ${activeFeature.parcel.reference}` : "Plan parcellaire";
    setOptions((current) => ({
      ...current,
      title: current.title && current.title !== defaultTitle ? current.title : nextTitle,
      fileName: current.fileName && current.fileName !== safeFileName(defaultTitle) ? current.fileName : safeFileName(nextTitle),
      author: current.author || author || "",
    }));
  }, [open, activeFeature, author, defaultTitle]);

  const legendItems = useMemo(() => getAvailableLegendItems(activeFeature ? [{ ...activeFeature, active: true }] : []), [activeFeature]);
  const activeLayerLegendItems = useMemo(
    () =>
      activeLayers
        .filter((layer) => layer.visible && layer.type !== "feature")
        .flatMap((layer) =>
          (layer.legend || []).map((item) => ({
            ...item,
            label: `${item.label} · ${layer.name}`,
          })),
        ),
    [activeLayers],
  );
  const fullLegend = useMemo(() => [...legendItems, ...activeLayerLegendItems], [legendItems, activeLayerLegendItems]);
  const summaryRows = useMemo(() => buildParcelAttributeRows(activeFeature), [activeFeature]);

  if (!open) return null;

  const update = (key, value) => setOptions((current) => ({ ...current, [key]: value }));

  const buildExportOptions = () => ({
    ...options,
    reference: options.includeReference ? activeFeature?.parcel?.reference : "",
    legendItems: options.includeLegend ? fullLegend : [],
    summaryRows: options.includeSummary ? summaryRows : [],
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const exportOptions = buildExportOptions();
      if (options.outputFormat === "geojson") {
        const feature = buildGeoJsonFeature(activeFeature);
        if (feature) {
          await exportGeometryAsGeoJson(feature, options.fileName || activeFeature?.parcel?.reference || "parcelle", exportOptions);
        }
      } else if (options.outputFormat === "png" || options.outputFormat === "jpeg") {
        await exportProfessionalMapImage(mapContainerRef.current, exportOptions);
      } else {
        await exportProfessionalMapPdf(mapContainerRef.current, exportOptions);
      }
      onClose?.();
    } finally {
      setExporting(false);
    }
  };

  const exportDisabled = exporting || (options.outputFormat === "geojson" && !activeFeature?.parcel?.geometry);
  const outputLabel = {
    pdf: "Générer le PDF",
    png: "Exporter le PNG",
    jpeg: "Exporter le JPEG",
    geojson: "Exporter le GeoJSON",
  }[options.outputFormat] || "Exporter";

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-mapgeo-primary/70 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[32px] border border-mapgeo-line bg-white shadow-panel">
        <div className="flex items-start justify-between gap-4 border-b border-mapgeo-line p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-mapgeo-secondary/50">Export cartographique professionnel</p>
            <h3 className="mt-1 text-2xl font-bold text-mapgeo-primary">Exporter la carte</h3>
            <p className="mt-1 text-sm text-mapgeo-secondary/70">
              Choisis le format, la résolution, le nom de fichier et les éléments cartographiques à intégrer.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-mapgeo-line p-2 text-mapgeo-secondary hover:bg-mapgeo-ivory">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-156px)] overflow-auto p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <FormatButton active={options.outputFormat === "pdf"} icon={FileDown} title="PDF" subtitle="Mise en page A4/A3" onClick={() => update("outputFormat", "pdf")} />
                <FormatButton active={options.outputFormat === "png"} icon={Image} title="PNG" subtitle="Image haute résolution" onClick={() => update("outputFormat", "png")} />
                <FormatButton active={options.outputFormat === "jpeg"} icon={Image} title="JPEG" subtitle="Image compressée" onClick={() => update("outputFormat", "jpeg")} />
                <FormatButton active={options.outputFormat === "geojson"} icon={FileCode2} title="GeoJSON" subtitle="Géométrie + attributs" onClick={() => update("outputFormat", "geojson")} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Titre">
                  <input value={options.title} onChange={(event) => update("title", event.target.value)} className={inputClass()} disabled={options.outputFormat === "geojson"} />
                </Field>
                <Field label="Nom du fichier" hint="Le navigateur choisit le dossier par défaut ; l’option “choisir l’emplacement” ouvre une boîte Enregistrer sous quand elle est disponible.">
                  <input value={options.fileName} onChange={(event) => update("fileName", event.target.value)} className={inputClass()} placeholder="plan-parcelle" />
                </Field>
              </div>

              {options.outputFormat === "pdf" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Format papier">
                    <select value={options.format} onChange={(event) => update("format", event.target.value)} className={inputClass()}>
                      <option value="a4">A4</option>
                      <option value="a3">A3</option>
                    </select>
                  </Field>
                  <Field label="Orientation">
                    <select value={options.orientation} onChange={(event) => update("orientation", event.target.value)} className={inputClass()}>
                      <option value="landscape">Paysage</option>
                      <option value="portrait">Portrait</option>
                    </select>
                  </Field>
                  <Field label="Résolution capture">
                    <select value={options.resolutionScale} onChange={(event) => update("resolutionScale", Number(event.target.value))} className={inputClass()}>
                      <option value={1}>Standard</option>
                      <option value={2}>Haute · x2</option>
                      <option value={3}>Très haute · x3</option>
                      <option value={4}>Ultra · x4</option>
                    </select>
                  </Field>
                </div>
              ) : options.outputFormat === "png" || options.outputFormat === "jpeg" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Résolution image">
                    <select value={options.resolutionScale} onChange={(event) => update("resolutionScale", Number(event.target.value))} className={inputClass()}>
                      <option value={1}>Standard écran</option>
                      <option value={2}>Haute résolution · x2</option>
                      <option value={3}>Très haute résolution · x3</option>
                      <option value={4}>Ultra HD · x4</option>
                    </select>
                  </Field>
                  <Field label="Composition">
                    <select value={options.professionalLayout ? "pro" : "map"} onChange={(event) => update("professionalLayout", event.target.value === "pro")} className={inputClass()}>
                      <option value="pro">Cadre pro complet</option>
                      <option value="map">Carte seule</option>
                    </select>
                  </Field>
                </div>
              ) : null}

              {options.outputFormat !== "geojson" ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Échelle">
                      <input value={options.scale} onChange={(event) => update("scale", event.target.value)} className={inputClass()} placeholder="1:2000 ou libre" />
                    </Field>
                    <Field label="Auteur / service">
                      <input value={options.author} onChange={(event) => update("author", event.target.value)} className={inputClass()} placeholder="Nom du géomètre, agent ou service" />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Toggle checked={options.includeTitle} label="Titre" onChange={(value) => update("includeTitle", value)} />
                    <Toggle checked={options.includeLegend} label="Légende" onChange={(value) => update("includeLegend", value)} />
                    <Toggle checked={options.includeNorth} label="Flèche Nord" onChange={(value) => update("includeNorth", value)} />
                    <Toggle checked={options.includeScale} label="Échelle graphique" onChange={(value) => update("includeScale", value)} />
                    <Toggle checked={options.includeDate} label="Date" onChange={(value) => update("includeDate", value)} />
                    <Toggle checked={options.includeSummary} label="Tableau attributaire" onChange={(value) => update("includeSummary", value)} />
                    <Toggle checked={options.includeReference} label="Référence parcelle" onChange={(value) => update("includeReference", value)} />
                    <Toggle checked={options.useSavePicker} label="Choisir l’emplacement" onChange={(value) => update("useSavePicker", value)} />
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/60 p-4 text-sm leading-6 text-mapgeo-secondary/80">
                  Le GeoJSON exporte la géométrie de la parcelle active avec les attributs essentiels : référence, commune, statut, surface et périmètre.
                  {activeFeature?.parcel?.geometry ? null : <strong className="block text-mapgeo-primary">Aucune géométrie exploitable pour cette parcelle.</strong>}
                </div>
              )}
            </div>

            <aside className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mapgeo-secondary/50">Sortie configurée</p>
              <div className="mt-3 space-y-3 text-sm text-mapgeo-secondary/80">
                <div className="rounded-2xl bg-white p-3">
                  <span className="block text-xs font-bold uppercase tracking-[0.14em] text-mapgeo-secondary/50">Format</span>
                  <strong className="mt-1 block text-mapgeo-primary">{options.outputFormat.toUpperCase()}</strong>
                </div>
                <div className="rounded-2xl bg-white p-3">
                  <span className="block text-xs font-bold uppercase tracking-[0.14em] text-mapgeo-secondary/50">Fichier</span>
                  <strong className="mt-1 block break-all text-mapgeo-primary">
                    {safeFileName(options.fileName || options.title || "export")}.{options.outputFormat === "jpeg" ? "jpg" : options.outputFormat}
                  </strong>
                </div>
                {options.outputFormat !== "geojson" ? (
                  <ul className="space-y-2 rounded-2xl bg-white p-3 text-xs leading-5">
                    <li>• Carte avec fond et couches actives</li>
                    {options.includeLegend ? <li>• Légende intégrée</li> : null}
                    {options.includeNorth ? <li>• Flèche Nord</li> : null}
                    {options.includeScale ? <li>• Échelle graphique</li> : null}
                    {options.includeSummary ? <li>• Synthèse parcellaire</li> : null}
                    <li>• Résolution x{options.resolutionScale}</li>
                  </ul>
                ) : null}
                <div className="rounded-2xl border border-mapgeo-line bg-white p-3 text-xs leading-5 text-mapgeo-secondary/75">
                  Pour un chemin exact, active “Choisir l’emplacement”. Les navigateurs non compatibles utiliseront le téléchargement classique.
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-mapgeo-line p-5">
          <button type="button" onClick={onClose} className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary">
            Annuler
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportDisabled}
            className="inline-flex items-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {exporting ? <Printer size={16} className="animate-pulse" /> : options.outputFormat === "geojson" ? <FileCode2 size={16} /> : <Download size={16} />}
            {exporting ? "Génération…" : outputLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
