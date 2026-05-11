import { FileText, MapPinned, Ruler, ShieldAlert, ShieldCheck } from "lucide-react";
import { formatArea, formatDistance } from "../../../utils/parcelGeometry";
import { getParcelStatusLabel } from "../../../constants/parcelConstants";
import { getSurfaceGapInfo, normalizeRiskLevel } from "../parcelMapStyles";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR");
}

function formatPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return `${numericValue > 0 ? "+" : ""}${numericValue.toFixed(2)} %`;
}

function pickValue(parcel, keys, fallback = "—") {
  for (const key of keys) {
    const value = parcel?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function Field({ label, value, strong = false, tone = "default" }) {
  const toneClass = {
    default: "text-mapgeo-primary",
    muted: "text-mapgeo-secondary/75",
    warning: "text-mapgeo-primary",
    danger: "text-mapgeo-primary",
    success: "text-mapgeo-primary",
  }[tone] || "text-mapgeo-primary";

  return (
    <div className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mapgeo-secondary/50">{label}</p>
      <p className={`mt-1 text-sm ${strong ? "font-bold" : "font-semibold"} ${toneClass}`}>{value || "—"}</p>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-mapgeo-primary">
        <Icon size={16} />
        <h4 className="font-bold">{title}</h4>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function buildParcelAttributeRows(feature) {
  if (!feature) return [];
  const parcel = feature.parcel || {};
  const surfaceGap = getSurfaceGapInfo(parcel);
  const risk = normalizeRiskLevel(parcel.risk_level || parcel.risk || parcel.risks);

  return [
    ["Référence", parcel.reference || "—"],
    ["Titre foncier", parcel.title_number || parcel.land_title || "—"],
    ["Numéro parcellaire", parcel.parcel_number || parcel.cadastral_number || "—"],
    ["Section", parcel.section || "—"],
    ["Commune", parcel.commune || "—"],
    ["Région", parcel.region || "—"],
    ["Surface officielle", formatArea(parcel.official_area || parcel.declared_area || parcel.area)],
    ["Surface calculée", formatArea(parcel.computed_area || parcel.calculated_area || parcel.geom_area)],
    ["Écart de surface", surfaceGap.hasBothAreas ? `${formatArea(surfaceGap.absolute)} · ${formatPercent(surfaceGap.percent)}` : "—"],
    ["Périmètre", formatDistance(parcel.computed_perimeter || parcel.perimeter || feature.perimeterValue)],
    ["Méthode de levé", parcel.method || parcel.survey_method || "—"],
    ["Date de levé", formatDate(parcel.survey_date || parcel.surveyed_at)],
    ["Précision GPS", pickValue(parcel, ["gps_accuracy", "gps_precision", "accuracy", "precision_gps"])],
    ["Statut juridique", parcel.legal_status || parcel.juridical_status || getParcelStatusLabel(parcel.status)],
    ["Risques", risk.label],
    ["Dernière modification géométrique", formatDateTime(parcel.geometry_updated_at || parcel.geometry_modified_at || parcel.updated_at)],
  ];
}

export default function ParcelAttributeSheet({ feature, clientCode, ownerName }) {
  if (!feature) return null;

  const parcel = feature.parcel || {};
  const surfaceGap = getSurfaceGapInfo(parcel);
  const risk = normalizeRiskLevel(parcel.risk_level || parcel.risk || parcel.risks);
  const documentsCount = feature.documents?.length || 0;
  const hasBlockingGap = surfaceGap.severity === "danger";
  const legalStatus = parcel.legal_status || parcel.juridical_status || getParcelStatusLabel(parcel.status);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-mapgeo-secondary/50">Fiche attributaire</p>
            <h3 className="mt-2 text-2xl font-bold text-mapgeo-primary">{parcel.reference || "Parcelle"}</h3>
            <p className="mt-1 text-sm text-mapgeo-secondary/70">
              {[parcel.section ? `Section ${parcel.section}` : null, parcel.commune, parcel.region].filter(Boolean).join(" · ") || "Localisation à compléter"}
            </p>
          </div>
          <span className="rounded-full border border-mapgeo-line bg-mapgeo-ivory px-3 py-1.5 text-xs font-bold text-mapgeo-primary">
            {legalStatus || "Statut non défini"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Field label="Référence" value={parcel.reference} strong />
          <Field label="Titre foncier" value={parcel.title_number || parcel.land_title} />
          <Field label="N° parcellaire" value={parcel.parcel_number || parcel.cadastral_number} />
          <Field label="Section" value={parcel.section} />
          <Field label="Client" value={clientCode || parcel.owner_client_code || ownerName} />
          <Field label="Propriétaire" value={parcel.owner_name || ownerName} />
        </div>
      </div>

      <Section icon={MapPinned} title="Localisation cadastrale">
        <Field label="Commune" value={parcel.commune} />
        <Field label="Région" value={parcel.region} />
        <Field label="Département" value={parcel.department} />
        <Field label="Adresse / lieu-dit" value={parcel.address || parcel.location || parcel.village} />
      </Section>

      <Section icon={Ruler} title="Surfaces et mesures">
        <Field label="Surface officielle" value={formatArea(parcel.official_area || parcel.declared_area || parcel.area)} />
        <Field label="Surface calculée" value={formatArea(parcel.computed_area || parcel.calculated_area || parcel.geom_area)} />
        <Field
          label="Écart de surface"
          value={surfaceGap.hasBothAreas ? `${formatArea(surfaceGap.absolute)} · ${formatPercent(surfaceGap.percent)}` : "—"}
          tone={hasBlockingGap ? "danger" : surfaceGap.severity === "warning" ? "warning" : "success"}
          strong
        />
        <Field label="Périmètre" value={formatDistance(parcel.computed_perimeter || parcel.perimeter || feature.perimeterValue)} />
      </Section>

      <Section icon={ShieldCheck} title="Levé et précision">
        <Field label="Méthode de levé" value={parcel.method || parcel.survey_method} />
        <Field label="Date de levé" value={formatDate(parcel.survey_date || parcel.surveyed_at)} />
        <Field label="Précision GPS" value={pickValue(parcel, ["gps_accuracy", "gps_precision", "accuracy", "precision_gps"])} />
        <Field label="Dernière modification géométrique" value={formatDateTime(parcel.geometry_updated_at || parcel.geometry_modified_at || parcel.updated_at)} />
      </Section>

      <Section icon={ShieldAlert} title="Juridique et risques">
        <Field label="Statut juridique" value={legalStatus} strong />
        <Field label="Niveau de risque" value={risk.label} tone={risk.severity === "high" ? "danger" : risk.severity === "medium" ? "warning" : "success"} strong />
        <Field label="Présence documentaire" value={documentsCount ? `${documentsCount} document(s)` : "Aucun document"} tone={documentsCount ? "success" : "warning"} />
        <Field label="Usage foncier" value={parcel.land_use || parcel.usage || "—"} />
      </Section>

      {parcel.notes ? (
        <section className="rounded-3xl border border-mapgeo-line bg-white p-5">
          <div className="mb-2 flex items-center gap-2 text-mapgeo-primary">
            <FileText size={16} />
            <h4 className="font-bold">Observations</h4>
          </div>
          <p className="text-sm leading-6 text-mapgeo-secondary/80">{parcel.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
