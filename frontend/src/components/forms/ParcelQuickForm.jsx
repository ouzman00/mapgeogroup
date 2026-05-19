import { CheckCircle2, FileUp, Loader2, Save, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import parcelService from "../../services/parcelService";
import { PARCEL_STATUS_OPTIONS, normalizeParcelStatus } from "../../constants/parcelConstants";
import { getErrorMessage } from "../../services/responseUtils";
import {
  GEOMETRY_IMPORT_CRS_OPTIONS,
  WGS84_GEOGRAPHIC_CRS,
  getDefaultSourceCrsForFormat,
  parseGeometryByFormat,
} from "../../utils/geometryIo";
import {
  geometryAreaM2Projected,
  geometryCentroidProjected,
  geometryToCoordinateText,
  geometryToRings,
  computePerimeterFromPoints,
  normalizeCoordinateValue,
} from "../../utils/parcelGeometry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  reference: "",
  nicad: "",
  owner: "",
  organization: "",
  location: "",
  commune: "",
  status: "planned",
  notes: "",
  rawText: "",
  geometry: null,
};

function getOwnerOrganizationId(owner = {}) {
  return String(
    owner.organization_id ||
    owner.organization ||
    owner.organizations?.find?.((organization) => organization.is_primary)?.id ||
    owner.organizations?.[0]?.id ||
    ""
  ).trim();
}

function toForm(initialValues) {
  if (!initialValues) return EMPTY_FORM;
  return {
    ...EMPTY_FORM,
    ...initialValues,
    status: normalizeParcelStatus(initialValues.status || EMPTY_FORM.status) || "planned",
    owner: initialValues.owner ? String(initialValues.owner) : "",
    organization: initialValues.organization ? String(initialValues.organization) : "",
    rawText: initialValues.rawText || geometryToCoordinateText(initialValues.geometry) || "",
    geometry: initialValues.geometry || null,
  };
}

function computeGeometryPerimeter(geometry) {
  if (!geometry) return null;
  const total = geometryToRings(geometry).reduce(
    (sum, ring) => sum + (computePerimeterFromPoints(ring) || 0),
    0,
  );
  return total > 0 ? Number(total.toFixed(2)) : null;
}

function looksLikeSimpleCoordinateList(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.startsWith("{") || text.startsWith("[") || text.startsWith("<")) return false;
  if (/^\s*(POLYGON|MULTIPOLYGON)\s*\(/i.test(text)) return false;

  const tokens = text
    .split(/[;\n\r\t]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < 3) return false;

  return tokens.every((token) => /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(token));
}

function tryParseGeometry(rawText, format, crs) {
  const text = String(rawText || "").trim();
  if (!text) return { geometry: null, error: null, format, crs };

  const isSimpleCoordinateList = looksLikeSimpleCoordinateList(text);
  const effectiveFormat = isSimpleCoordinateList ? "csv" : format;
  const effectiveCrs = isSimpleCoordinateList ? getDefaultSourceCrsForFormat("csv") : crs;

  try {
    const geometry = parseGeometryByFormat(text, effectiveFormat, { sourceCrs: effectiveCrs });
    return { geometry, error: null, format: effectiveFormat, crs: effectiveCrs };
  } catch (err) {
    return { geometry: null, error: err.message || "Impossible de lire la geometrie.", format: effectiveFormat, crs: effectiveCrs };
  }
}

function buildPayload(form, format, crs, owners = []) {
  const reference = String(form.reference || "").trim();
  const ownerId = String(form.owner || "").trim();
  const rawText = String(form.rawText || "").trim();
  const shouldUseCoordinateText = looksLikeSimpleCoordinateList(rawText);

  if (!reference) {
    throw new Error("La référence est obligatoire.");
  }

  if (!ownerId) {
    throw new Error("Le client est obligatoire.");
  }

  const selectedOwner = owners.find((owner) => String(owner.id) === ownerId);
  const organizationId = String(form.organization || getOwnerOrganizationId(selectedOwner) || "").trim();

  if (!organizationId) {
    throw new Error("Le client sélectionné n'est rattaché à aucune organisation active.");
  }

  let { geometry } = form;

  if (!shouldUseCoordinateText && !geometry && rawText) {
    const { geometry: parsed, error } = tryParseGeometry(rawText, format, crs);
    if (parsed) {
      geometry = parsed;
    } else if (error) {
      throw new Error(`Géométrie invalide : ${error}`);
    }
  }

  const center = geometry ? geometryCentroidProjected(geometry) : null;
  const areaM2 = geometry ? geometryAreaM2Projected(geometry) : 0;
  const perimeter = geometry ? computeGeometryPerimeter(geometry) : null;
  const area = areaM2 > 0 ? Number(areaM2.toFixed(2)) : 0;

  const payload = {
    reference,
    nicad: (form.nicad || "").trim() || null,
    location: (form.location || "").trim() || "Non précisé",
    commune: (form.commune || "").trim(),
    area,
    perimeter: perimeter ?? 0,
    status: form.status,
    notes: (form.notes || "").trim(),
    latitude: center ? normalizeCoordinateValue(center[0]) : null,
    longitude: center ? normalizeCoordinateValue(center[1]) : null,
    centroid_northing: center ? normalizeCoordinateValue(center[0]) : null,
    centroid_easting: center ? normalizeCoordinateValue(center[1]) : null,
    owner: Number(ownerId),
    organization: Number(organizationId),
  };

  if (shouldUseCoordinateText) {
    payload.coordinates_text = rawText;
  } else {
    payload.geometry = geometry || null;
  }

  return payload;
}

function GeometryStatusBadge({ geometry, parseError }) {
  if (parseError) {
    return (
      <span className="inline-flex items-start gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">
        <XCircle size={13} className="mt-0.5 shrink-0" />
        <span>{parseError}</span>
      </span>
    );
  }
  if (geometry) {
    const area = geometryAreaM2Projected(geometry);
    const areaLabel = area > 0
      ? area.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " m²"
      : "surface calculée";
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
        <CheckCircle2 size={13} className="shrink-0" />
        Géométrie valide · {areaLabel}
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ParcelQuickForm({
  owners = [],
  initialValues = null,
  submitLabel = "Enregistrer",
  title = "Ajouter une parcelle",
  subtitle = "Créer rapidement une parcelle et rattacher sa géométrie au portefeuille du client.",
  variant = "light",
  compact = false,
  onSuccess,
  onCancel,
  onGeometryPreview,
}) {
  const [form, setForm] = useState(() => toForm(initialValues));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [importFormat, setImportFormat] = useState("csv");
  const [importCrs, setImportCrs] = useState(() => getDefaultSourceCrsForFormat("csv"));
  const [liveParseError, setLiveParseError] = useState("");
  const parseTimerRef = useRef(null);

  useEffect(() => {
    setForm(toForm(initialValues));
    setMessage("");
    setMessageType("info");
    setLiveParseError("");
  }, [initialValues]);

  // Parse debounced while user types
  const handleRawTextChange = (event) => {
    const raw = event.target.value;
    setForm((f) => ({ ...f, rawText: raw, geometry: null }));
    setLiveParseError("");

    if (looksLikeSimpleCoordinateList(raw) && importFormat !== "csv") {
      const nextCrs = getDefaultSourceCrsForFormat("csv");
      setImportFormat("csv");
      setImportCrs(nextCrs);
    }

    if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    if (!raw.trim()) return;

    parseTimerRef.current = setTimeout(() => {
      const { geometry, error, format: parsedFormat, crs: parsedCrs } = tryParseGeometry(raw, importFormat, importCrs);

      if (parsedFormat && parsedFormat !== importFormat) setImportFormat(parsedFormat);
      if (parsedCrs && parsedCrs !== importCrs) setImportCrs(parsedCrs);

      if (geometry) {
        setForm((f) => ({ ...f, geometry }));
        setLiveParseError("");
      } else if (error) {
        setLiveParseError(error);
      }
    }, 500);
  };

  const reparse = (raw, fmt, crs) => {
    if (!raw.trim()) return;
    const { geometry, error } = tryParseGeometry(raw, fmt, crs);
    if (geometry) { setForm((f) => ({ ...f, geometry })); setLiveParseError(""); }
    else if (error) { setForm((f) => ({ ...f, geometry: null })); setLiveParseError(error); }
  };

  const handleFormatChange = (nextFormat) => {
    setImportFormat(nextFormat);
    const nextCrs = getDefaultSourceCrsForFormat(nextFormat);
    setImportCrs(nextCrs);
    reparse(form.rawText, nextFormat, nextCrs);
  };

  const handleCrsChange = (nextCrs) => {
    setImportCrs(nextCrs);
    reparse(form.rawText, importFormat, nextCrs);
  };

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleFileImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const guessedFormat = ext === "csv" ? "csv"
        : ext === "kml" ? "kml"
        : ext === "wkt" ? "wkt"
        : "geojson";
      const guessedCrs = getDefaultSourceCrsForFormat(guessedFormat);
      setImportFormat(guessedFormat);
      setImportCrs(guessedCrs);

      const { geometry, error } = tryParseGeometry(text, guessedFormat, guessedCrs);
      if (geometry) {
        const coordText = geometryToCoordinateText(geometry);
        setForm((f) => ({ ...f, rawText: coordText || text, geometry }));
        setLiveParseError("");
      } else {
        setForm((f) => ({ ...f, rawText: text, geometry: null }));
        setLiveParseError(error || "Fichier non reconnu.");
      }
    } catch (err) {
      setLiveParseError(err.message || "Erreur de lecture du fichier.");
    }
  };

  const parseCurrentGeometry = () => {
    if (!form.rawText.trim()) {
      return { geometry: null, error: "Aucune coordonnée à tracer." };
    }

    const { geometry, error, format: parsedFormat, crs: parsedCrs } = tryParseGeometry(form.rawText, importFormat, importCrs);

    if (parsedFormat && parsedFormat !== importFormat) setImportFormat(parsedFormat);
    if (parsedCrs && parsedCrs !== importCrs) setImportCrs(parsedCrs);

    if (geometry) {
      setForm((f) => ({ ...f, geometry }));
      setLiveParseError("");
      return { geometry, error: null };
    }

    const message = error || "Impossible de lire la geometrie.";
    setLiveParseError(message);
    return { geometry: null, error: message };
  };

  const handleConvert = () => {
    parseCurrentGeometry();
  };

  const handlePreviewGeometry = () => {
    const { geometry } = parseCurrentGeometry();
    if (!geometry) return;

    onGeometryPreview?.(geometry);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    try {
      const payload = buildPayload(form, importFormat, importCrs, owners);
      const savedParcel = await parcelService.createParcel(payload);
      setMessage("Parcelle créée avec succès.");
      setMessageType("success");
      setForm(EMPTY_FORM);
      setLiveParseError("");
      onGeometryPreview?.(null);
      await onSuccess?.(savedParcel);
    } catch (error) {
      setMessage(getErrorMessage(error, "Impossible d'enregistrer la parcelle."));
      setMessageType("error");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const dark = variant === "dark";

  const sectionClass = dark
    ? "rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
    : "rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft";

  const titleClass = dark ? "text-base font-extrabold text-white" : "text-lg font-bold text-mapgeo-primary";
  const subtitleClass = dark ? "mt-1 text-xs leading-5 text-white/50" : "mt-1 text-xs leading-5 text-mapgeo-secondary/70";
  const labelClass = dark
    ? "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/45"
    : "mb-1.5 block text-xs font-semibold text-mapgeo-secondary/80";

  const fieldBase = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition";
  const fieldClass = dark
    ? `${fieldBase} border-white/12 bg-white/[0.07] text-white placeholder:text-white/30 focus:border-mapgeo-sand/55 focus:bg-white/[0.1]`
    : `${fieldBase} border-mapgeo-line bg-white text-mapgeo-primary placeholder:text-mapgeo-secondary/40 focus:border-mapgeo-primary/40 focus:ring-2 focus:ring-mapgeo-primary/5`;

  const selectClass = dark
    ? `${fieldClass} mapgeo-dark-select bg-[#0e2035]`
    : fieldClass;

  const darkOption = dark ? "bg-[#123B5D] text-white" : undefined;

  const controlSelectClass = dark
    ? "mapgeo-dark-select rounded-xl border border-white/12 bg-[#0e2035] px-3 py-2 text-sm text-white outline-none transition hover:border-white/25"
    : "rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-sm text-mapgeo-primary outline-none transition hover:border-mapgeo-primary/30";

  const btnSecondary = dark
    ? "inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.07] px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.12] disabled:opacity-40 transition"
    : "inline-flex items-center justify-center gap-1.5 rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-sm font-semibold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-40 transition";

  const btnPrimary = dark
    ? "inline-flex items-center gap-2 rounded-xl bg-mapgeo-primary px-5 py-2.5 text-sm font-extrabold text-white shadow-soft transition hover:bg-mapgeo-sand disabled:opacity-50"
    : "inline-flex items-center gap-2 rounded-xl bg-mapgeo-primary px-5 py-2.5 text-sm font-extrabold text-white shadow-soft transition hover:bg-mapgeo-primary/90 disabled:opacity-50";

  const btnCancel = dark
    ? "rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/[0.07] transition"
    : "rounded-xl border border-mapgeo-line px-4 py-2.5 text-sm font-semibold text-mapgeo-primary hover:bg-mapgeo-ivory transition";

  const gridClass = compact ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2";
  const fullRow = compact ? "" : "sm:col-span-2";
  const hintClass = dark ? "mt-2 text-[11px] leading-5 text-white/35" : "mt-2 text-[11px] leading-5 text-mapgeo-secondary/55";

  const textareaClass = dark
    ? `w-full resize-y rounded-xl border border-white/12 bg-white/[0.07] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-mapgeo-sand/55 focus:bg-white/[0.1] transition`
    : `w-full resize-y rounded-xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm text-mapgeo-primary outline-none placeholder:text-mapgeo-secondary/40 focus:border-mapgeo-primary/40 focus:ring-2 focus:ring-mapgeo-primary/5 transition`;

  // Placeholder hint per format
  const textareaPlaceholder = {
    csv: "Ex : 287802,1633540\n287850,1633590\n287830,1633480\n\nOu : 287802,1633540; 287850,1633590; 287830,1633480",
    geojson: '{\n  "type": "Polygon",\n  "coordinates": [[[287802,1633540],[287850,1633590],[287830,1633480],[287802,1633540]]]\n}',
    wkt: "POLYGON((287802 1633540, 287850 1633590, 287830 1633480, 287802 1633540))",
    kml: "Coller le contenu du fichier .kml ici…",
  }[importFormat] || "";

  const formatHint = {
    csv: "Coordonnées X,Y — une paire par ligne ou séparées par « ; ». Mètres EPSG:32628 par défaut.",
    geojson: "GeoJSON : Polygon, MultiPolygon, Feature ou FeatureCollection. Mètres EPSG:32628 par défaut.",
    wkt: "WKT : POLYGON((x1 y1, x2 y2, …)) — coordonnées séparées par un espace. Mètres EPSG:32628.",
    kml: "Contenu XML .kml — les coordonnées lon/lat WGS84 sont converties automatiquement.",
  }[importFormat] || "";

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------
  return (
    <section className={sectionClass}>
      {(title || subtitle) ? (
        <div className="mb-4">
          {title ? <h3 className={titleClass}>{title}</h3> : null}
          {subtitle ? <p className={subtitleClass}>{subtitle}</p> : null}
        </div>
      ) : null}

      <form className={gridClass} onSubmit={handleSubmit} noValidate>

        {/* Référence */}
        <div>
          <label className={labelClass}>Référence *</label>
          <input
            name="reference"
            value={form.reference}
            onChange={handleFieldChange}
            className={fieldClass}
            placeholder="PARC-001"
          />
        </div>

        {/* NICAD */}
        <div>
          <label className={labelClass}>NICAD</label>
          <input
            name="nicad"
            value={form.nicad}
            onChange={handleFieldChange}
            className={fieldClass}
            placeholder="Numéro NICAD"
          />
        </div>

        {/* Client */}
        {owners.length ? (
          <div>
            <label className={labelClass}>Client *</label>
            <select
              name="owner"
              value={form.owner}
              onChange={handleFieldChange}
              className={selectClass}
            >
              <option value="" className={darkOption}>— Sélectionner un client —</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id} className={darkOption}>{o.label}</option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Localisation */}
        <div>
          <label className={labelClass}>Localisation</label>
          <input
            name="location"
            value={form.location}
            onChange={handleFieldChange}
            className={fieldClass}
            placeholder="Quartier, village, adresse..."
          />
        </div>

        {/* Commune */}
        <div>
          <label className={labelClass}>Commune</label>
          <input
            name="commune"
            value={form.commune}
            onChange={handleFieldChange}
            className={fieldClass}
          />
        </div>

        {/* Statut */}
        <div>
          <label className={labelClass}>Statut</label>
          <select name="status" value={form.status} onChange={handleFieldChange} className={selectClass}>
            {PARCEL_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className={darkOption}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Géométrie */}
        <div className={fullRow}>
          <label className={labelClass}>Géométrie de la parcelle</label>

          {/* Barre de contrôles format/CRS/fichier — AVANT la textarea */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select
              value={importFormat}
              onChange={(e) => handleFormatChange(e.target.value)}
              className={controlSelectClass}
              aria-label="Format d'import"
            >
              <option value="csv" className={darkOption}>CSV / X,Y</option>
              <option value="geojson" className={darkOption}>GeoJSON</option>
              <option value="kml" className={darkOption}>KML</option>
              <option value="wkt" className={darkOption}>WKT</option>
            </select>

            {importFormat !== "kml" ? (
              <select
                value={importCrs}
                onChange={(e) => handleCrsChange(e.target.value)}
                className={controlSelectClass}
                aria-label="Système de coordonnées"
              >
                {GEOMETRY_IMPORT_CRS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className={darkOption}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <span className={`rounded-xl border px-3 py-2 text-xs font-semibold ${dark ? "border-white/10 text-white/35" : "border-mapgeo-line text-mapgeo-secondary/50"}`}>
                Lon/Lat WGS84 (KML)
              </span>
            )}

            <label className={`${btnSecondary} cursor-pointer`}>
              <FileUp size={14} /> Importer une géométrie
              <input
                type="file"
                accept=".csv,.json,.geojson,.kml,.wkt,text/csv,application/geo+json"
                onChange={handleFileImport}
                className="sr-only"
              />
            </label>
          </div>

          {/* Zone de saisie */}
          <textarea
            value={form.rawText}
            onChange={handleRawTextChange}
            rows={4}
            className={textareaClass}
            placeholder={textareaPlaceholder}
            spellCheck={false}
          />

          {/* Statut parse en temps réel */}
          <div className="mt-2">
            {(form.rawText.trim() && !form.geometry && !liveParseError) ? (
              <span className={`text-xs ${dark ? "text-white/40" : "text-mapgeo-secondary/50"}`}>Saisie en cours…</span>
            ) : (
              <GeometryStatusBadge geometry={form.geometry} parseError={liveParseError} />
            )}
          </div>

          {/* Aide contextuelle + bouton convertir */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className={hintClass}>{formatHint}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePreviewGeometry}
                disabled={!form.rawText.trim()}
                className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-45`}
              >
                Tracer sur la carte
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={!form.rawText.trim()}
                className={`${btnSecondary} disabled:cursor-not-allowed disabled:opacity-45`}
              >
                ↺ Forcer la conversion
              </button>
            </div>
          </div>
        </div>

        {!owners.length ? (
          <div className={fullRow}>
            <p className={dark ? "rounded-xl border border-red-500/30 bg-red-900/25 px-4 py-3 text-sm font-medium text-red-300" : "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"}>
              Aucun client disponible pour créer une parcelle.
            </p>
          </div>
        ) : null}

        {/* Actions */}
        <div className={`${fullRow} flex flex-wrap items-center gap-3 border-t pt-4 ${dark ? "border-white/10" : "border-mapgeo-line"}`}>
          <button type="submit" disabled={submitting || !owners.length} className={btnPrimary}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {submitting ? "Création en cours…" : submitLabel}
          </button>
          {onCancel ? (
            <button type="button" onClick={onCancel} className={btnCancel}>Annuler</button>
          ) : null}
        </div>
      </form>

      {/* Résultat */}
      {message ? (
        <div className={`mt-3 rounded-xl border px-4 py-3 text-sm font-medium ${
          messageType === "success"
            ? dark ? "border-green-500/30 bg-green-900/25 text-green-300" : "border-green-200 bg-green-50 text-green-800"
            : dark ? "border-red-500/30 bg-red-900/25 text-red-300" : "border-red-200 bg-red-50 text-red-800"
        }`}>
          {message}
        </div>
      ) : null}
    </section>
  );
}
