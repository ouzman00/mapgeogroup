import { FileUp, Save } from "lucide-react";
import { useEffect, useState } from "react";
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
  computePerimeterFromPoints,
  geometryAreaM2Projected,
  geometryCentroidProjected,
  geometryToCoordinateText,
  geometryToRings,
  normalizeCoordinateValue,
} from "../../utils/parcelGeometry";

const EMPTY_FORM = {
  reference: "",
  owner: "",
  location: "",
  commune: "",
  area: "",
  status: "planned",
  notes: "",
  coordinates_text: "",
  latitude: "",
  longitude: "",
  geometry: null,
};

function toForm(initialValues) {
  if (!initialValues) return EMPTY_FORM;
  return {
    ...EMPTY_FORM,
    ...initialValues,
    status: normalizeParcelStatus(initialValues.status || EMPTY_FORM.status),
    owner: initialValues.owner || "",
    area: initialValues.area ?? "",
    coordinates_text: initialValues.coordinates_text || geometryToCoordinateText(initialValues.geometry),
    latitude: initialValues.latitude ?? "",
    longitude: initialValues.longitude ?? "",
    geometry: initialValues.geometry || null,
  };
}

function computeGeometryPerimeter(geometry) {
  const perimeter = geometryToRings(geometry).reduce((total, ring) => total + (computePerimeterFromPoints(ring) || 0), 0);
  return perimeter > 0 ? Number(perimeter.toFixed(2)) : null;
}

function normalizePayload(form) {
  const computedArea = form.geometry ? geometryAreaM2Projected(form.geometry) : 0;
  const computedPerimeter = form.geometry ? computeGeometryPerimeter(form.geometry) : null;
  const area = computedArea > 0 ? Number(computedArea.toFixed(2)) : null;

  const payload = {
    reference: form.reference.trim(),
    location: form.location.trim(),
    commune: form.commune.trim(),
    area,
    perimeter: computedPerimeter,
    status: form.status,
    notes: form.notes?.trim() || "",
    coordinates_text: form.geometry ? "" : form.coordinates_text?.trim() || "",
    // Compatibilité backend historique : latitude = Y/Northing, longitude = X/Easting.
    latitude: form.latitude === "" ? null : Number(form.latitude),
    longitude: form.longitude === "" ? null : Number(form.longitude),
    centroid_northing: form.latitude === "" ? null : Number(form.latitude),
    centroid_easting: form.longitude === "" ? null : Number(form.longitude),
    geometry: form.geometry || null,
  };

  if (form.owner) payload.owner = Number(form.owner);

  return payload;
}

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
}) {
  const [form, setForm] = useState(() => toForm(initialValues));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [geometryImportFormat, setGeometryImportFormat] = useState("csv");
  const [geometryImportCrs, setGeometryImportCrs] = useState(() => getDefaultSourceCrsForFormat("csv"));
  const [geometryImportMessage, setGeometryImportMessage] = useState("");

  useEffect(() => {
    setForm(toForm(initialValues));
    setMessage("");
    setGeometryImportMessage("");
  }, [initialValues]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    if (name === "coordinates_text") {
      setGeometryImportMessage("");
      setForm((current) => ({
        ...current,
        [name]: value,
        geometry: null,
        latitude: "",
        longitude: "",
        area: "",
      }));
      return;
    }

    setForm((current) => ({ ...current, [name]: value }));
  };

  const applyImportedGeometry = (geometry, sourceLabel) => {
    const center = geometryCentroidProjected(geometry);
    const areaM2 = geometryAreaM2Projected(geometry);

    setForm((current) => ({
      ...current,
      geometry,
      coordinates_text: geometryToCoordinateText(geometry),
      latitude: center ? normalizeCoordinateValue(center[0]) : current.latitude,
      longitude: center ? normalizeCoordinateValue(center[1]) : current.longitude,
      area: areaM2 > 0 ? Number(areaM2.toFixed(2)) : "",
    }));

    setGeometryImportMessage(
      `${sourceLabel} importé${areaM2 > 0 ? ` · ${areaM2.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} m²` : ""}`,
    );
  };

  const handleGeometryFileImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const extension = file.name.split(".").pop()?.toLowerCase();
      const guessedFormat = extension === "csv" ? "csv" : extension === "kml" ? "kml" : extension === "wkt" ? "wkt" : "geojson";
      const sourceCrs = getDefaultSourceCrsForFormat(guessedFormat);
      setGeometryImportFormat(guessedFormat);
      setGeometryImportCrs(sourceCrs);

      const geometry = parseGeometryByFormat(text, guessedFormat, { sourceCrs });
      const crsLabel = sourceCrs === WGS84_GEOGRAPHIC_CRS ? "EPSG:4326" : "EPSG:32628";
      applyImportedGeometry(geometry, `${guessedFormat.toUpperCase()} ${crsLabel}`);
    } catch (error) {
      setGeometryImportMessage(error.message || "Import de géométrie impossible.");
    } finally {
      event.target.value = "";
    }
  };

  const handleCoordinatesTextImport = () => {
    try {
      const geometry = parseGeometryByFormat(form.coordinates_text, geometryImportFormat, { sourceCrs: geometryImportCrs });
      const crsLabel = geometryImportCrs === WGS84_GEOGRAPHIC_CRS ? "EPSG:4326" : "EPSG:32628";
      applyImportedGeometry(geometry, `${geometryImportFormat.toUpperCase()} ${crsLabel}`);
    } catch (error) {
      setGeometryImportMessage(error.message || "Import de géométrie impossible.");
    }
  };

  const buildFormWithImportedGeometry = (currentForm) => {
    if (currentForm.geometry) return currentForm;

    const rawGeometryText = currentForm.coordinates_text?.trim();
    if (!rawGeometryText) {
      throw new Error("La géométrie est obligatoire : renseigne les coordonnées puis clique sur Convertir, ou laisse Créer la convertir automatiquement.");
    }

    const geometry = parseGeometryByFormat(rawGeometryText, geometryImportFormat, { sourceCrs: geometryImportCrs });
    const center = geometryCentroidProjected(geometry);
    const areaM2 = geometryAreaM2Projected(geometry);

    return {
      ...currentForm,
      geometry,
      coordinates_text: geometryToCoordinateText(geometry),
      latitude: center ? normalizeCoordinateValue(center[0]) : currentForm.latitude,
      longitude: center ? normalizeCoordinateValue(center[1]) : currentForm.longitude,
      area: areaM2 > 0 ? Number(areaM2.toFixed(2)) : currentForm.area,
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setGeometryImportMessage("");

    try {
      const formForPayload = buildFormWithImportedGeometry(form);
      setForm(formForPayload);

      const payload = normalizePayload(formForPayload);
      const savedParcel = await parcelService.createParcel(payload);
      setMessage("Parcelle créée avec succès.");
      setForm(EMPTY_FORM);
      await onSuccess?.(savedParcel);
    } catch (error) {
      const errorMessage = getErrorMessage(error, "Impossible d’enregistrer la parcelle.");
      setMessage(errorMessage);
      if (!error?.response) {
        setGeometryImportMessage(errorMessage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const dark = variant === "dark";
  const sectionClass = dark
    ? "rounded-2xl border border-white/10 bg-white/[0.035] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
    : "rounded-3xl border border-mapgeo-line bg-white p-4 shadow-soft";
  const titleClass = dark ? "text-base font-extrabold text-white" : "text-lg font-bold text-mapgeo-primary";
  const subtitleClass = dark ? "mt-1 text-xs leading-5 text-white/50" : "mt-1 text-xs leading-5 text-mapgeo-secondary/70";
  const labelClass = dark
    ? "mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40"
    : "mb-1 block text-xs font-semibold text-mapgeo-secondary";
  const fieldClass = dark
    ? "w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-mapgeo-sand/50"
    : "w-full rounded-xl border border-mapgeo-line bg-mapgeo-ivory/50 px-3 py-2 text-sm outline-none";
  const selectFieldClass = dark
    ? `${fieldClass} mapgeo-dark-select bg-[#123B5D]/95 text-white`
    : fieldClass;
  const darkOptionClass = dark ? "bg-[#123B5D] text-white" : undefined;
  const secondaryButtonClass = dark
    ? "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm font-bold text-white/75 hover:bg-white/10 disabled:opacity-45"
    : "inline-flex items-center justify-center gap-2 rounded-xl border border-mapgeo-line px-3 py-2 text-sm font-semibold text-mapgeo-primary disabled:opacity-45";
  const primaryButtonClass = dark
    ? "inline-flex items-center gap-2 rounded-xl bg-mapgeo-primary px-4 py-2.5 text-sm font-extrabold text-white shadow-soft transition hover:bg-mapgeo-sand disabled:opacity-60"
    : "inline-flex items-center gap-2 rounded-xl bg-mapgeo-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
  const cancelButtonClass = dark
    ? "rounded-xl border border-white/10 bg-white/[0.045] px-4 py-2.5 text-sm font-bold text-white/75 hover:bg-white/10"
    : "rounded-xl border border-mapgeo-line px-4 py-2 text-sm font-semibold text-mapgeo-primary";
  const formGridClass = compact ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 md:grid-cols-2";
  const fullRowClass = compact ? "" : "md:col-span-2";
  const importControlsClass = compact
    ? "mt-2 grid grid-cols-2 gap-2"
    : "mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[110px_minmax(0,1fr)_auto_auto] lg:items-center";
  const importFormatClass = compact ? `${fieldClass} col-span-2` : fieldClass;
  const importCrsClass = compact ? `${fieldClass} col-span-2` : fieldClass;
  const textareaRows = 2;
  const importMessageClass = dark
    ? "mt-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-semibold text-white/70"
    : "mt-2 rounded-xl border border-mapgeo-line bg-mapgeo-ivory/40 px-3 py-2 text-xs font-semibold text-mapgeo-primary";
  const resultMessageClass = dark
    ? "mt-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-white/70"
    : "mt-3 rounded-xl border border-mapgeo-line bg-mapgeo-ivory/40 px-3 py-2 text-sm text-mapgeo-primary";

  return (
    <section className={sectionClass}>
      {title || subtitle ? (
        <div className="mb-3">
          {title ? <h3 className={titleClass}>{title}</h3> : null}
          {subtitle ? <p className={subtitleClass}>{subtitle}</p> : null}
        </div>
      ) : null}

      <form className={formGridClass} onSubmit={handleSubmit}>
        <div>
          <label className={labelClass}>Référence *</label>
          <input
            required
            name="reference"
            value={form.reference}
            onChange={handleChange}
            className={fieldClass}
            placeholder="PARC-002"
          />
        </div>

        {owners.length ? (
          <div>
            <label className={labelClass}>Client *</label>
            <select
              required
              name="owner"
              value={form.owner}
              onChange={handleChange}
              className={selectFieldClass}
            >
              <option value="" className={darkOptionClass}>Sélectionner un client</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id} className={darkOptionClass}>
                  {owner.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className={labelClass}>Localisation *</label>
          <input
            required
            name="location"
            value={form.location}
            onChange={handleChange}
            className={fieldClass}
            placeholder="Quartier, village, adresse..."
          />
        </div>

        <div>
          <label className={labelClass}>Commune</label>
          <input
            name="commune"
            value={form.commune}
            onChange={handleChange}
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass}>Statut</label>
          <select
            name="status"
            value={form.status}
            onChange={handleChange}
            className={selectFieldClass}
          >
            {PARCEL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className={darkOptionClass}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className={fullRowClass}>
          <label className={labelClass}>
            Import géométrie
          </label>
          <textarea
            name="coordinates_text"
            value={form.coordinates_text}
            onChange={handleChange}
            rows={textareaRows}
            className={fieldClass}
            placeholder="Ex. X/Easting;Y/Northing en mètres EPSG:32628, CSV X;Y, GeoJSON, KML ou WKT"
          />

          <div className={importControlsClass}>
            <select
              value={geometryImportFormat}
              onChange={(event) => { const nextFormat = event.target.value; setGeometryImportFormat(nextFormat); setGeometryImportCrs(getDefaultSourceCrsForFormat(nextFormat)); }}
              className={`${importFormatClass} ${dark ? "mapgeo-dark-select bg-[#123B5D]/95 text-white" : ""}`}
            >
              <option value="geojson" className={darkOptionClass}>GeoJSON</option>
              <option value="csv" className={darkOptionClass}>CSV / liste X-Y</option>
              <option value="kml" className={darkOptionClass}>KML</option>
              <option value="wkt" className={darkOptionClass}>WKT</option>
            </select>

            <select
              value={geometryImportCrs}
              onChange={(event) => setGeometryImportCrs(event.target.value)}
              disabled={geometryImportFormat === "kml"}
              className={`${importCrsClass} ${dark ? "mapgeo-dark-select bg-[#123B5D]/95 text-white" : ""} disabled:opacity-50`}
            >
              {GEOMETRY_IMPORT_CRS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className={darkOptionClass}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className={`${secondaryButtonClass} cursor-pointer`}>
              <FileUp size={15} /> Importer
              <input
                type="file"
                accept=".csv,.json,.geojson,.kml,.wkt,text/csv,application/geo+json"
                onChange={handleGeometryFileImport}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={handleCoordinatesTextImport}
              disabled={!form.coordinates_text.trim()}
              className={secondaryButtonClass}
            >
              Convertir
            </button>
          </div>


          {geometryImportMessage ? (
            <p className={importMessageClass}>
              {geometryImportMessage}
            </p>
          ) : null}
        </div>


        <div className={`${fullRowClass} flex flex-wrap gap-3`}>
          <button
            disabled={submitting}
            type="submit"
            className={primaryButtonClass}
          >
            <Save size={18} /> {submitting ? "Enregistrement..." : submitLabel}
          </button>

          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className={cancelButtonClass}
            >
              Fermer
            </button>
          ) : null}
        </div>
      </form>

      {message ? (
        <div className={resultMessageClass}>
          {message}
        </div>
      ) : null}
    </section>
  );
}