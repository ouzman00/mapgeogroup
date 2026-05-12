import { CalendarCheck2, CheckCircle2, Edit3, FileText, FolderOpen, Printer, Route, Save, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import documentService from "../../../services/documentService";
import { getErrorMessage } from "../../../services/responseUtils";
import ParcelQuickForm from "../../forms/ParcelQuickForm";
import { PARCEL_STATUS_OPTIONS, normalizeParcelStatus } from "../../../constants/parcelConstants";
import { SENEGAL_PROJECTED_CRS, SENEGAL_PROJECTED_CRS_LABEL, latLngPairToProjected } from "../../../utils/parcelGeometry";
import { formatProjectedCoordinate } from "./mapUtils";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-white/50">{label}</span>
      <strong className="max-w-[160px] truncate text-right font-semibold text-white/80">{value || "—"}</strong>
    </div>
  );
}

function DarkCard({ title, icon: Icon, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {title ? (
        <div className="mb-4 flex items-center gap-2 text-white">
          {Icon ? <Icon size={16} className="text-white/60" /> : null}
          <h4 className="text-sm font-extrabold tracking-tight">{title}</h4>
        </div>
      ) : null}
      {children}
    </section>
  );
}


function buildVertexRows(activeFeature) {
  const rings = activeFeature?.rings || [];
  return rings.flatMap((ring, ringIndex) => (
    (Array.isArray(ring) ? ring : [])
      .filter((point) => Array.isArray(point) && point.length >= 2)
      .map((point, vertexIndex) => {
        const projected = latLngPairToProjected(point);
        return {
          id: `${ringIndex + 1}-${vertexIndex + 1}-${point[0]}-${point[1]}`,
          label: rings.length > 1 ? `Contour ${ringIndex + 1} · Sommet ${vertexIndex + 1}` : `Sommet ${vertexIndex + 1}`,
          x: projected?.[0] ?? null,
          y: projected?.[1] ?? null,
        };
      })
  ));
}

function DataQualityCard({ feature }) {
  if (!feature) return null;
  const checks = [
    { label: "Géométrie", ok: feature.rings.length > 0 },
    { label: "Surface", ok: feature.areaLabel !== "—" },
    { label: "Périmètre", ok: feature.perimeterLabel !== "—" },
    { label: "Commune", ok: Boolean(feature.parcel.commune) },
    { label: "Document", ok: feature.documents.length > 0 },
  ];
  const score = Math.round((checks.filter((check) => check.ok).length / checks.length) * 100);

  return (
    <DarkCard title="Qualité SIG" icon={ShieldCheck}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm text-white/60">Score de complétude</span>
        <strong className="rounded-full bg-mapgeo-sand/20 px-2.5 py-1 text-sm text-mapgeo-sand ring-1 ring-mapgeo-sand/20">{score}%</strong>
      </div>
      <div className="space-y-2 text-xs">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center justify-between gap-3 text-white/50">
            <span>{check.label}</span>
            <span className={check.ok ? "font-bold text-mapgeo-sand" : "font-bold text-mapgeo-sand"}>{check.ok ? "OK" : "À compléter"}</span>
          </div>
        ))}
      </div>
    </DarkCard>
  );
}

function ProgressStepper({ progress = 0 }) {
  const steps = [
    { label: "Créée", threshold: 1 },
    { label: "Vérification", threshold: 15 },
    { label: "Mission planifiée", threshold: 45 },
    { label: "Rapport finalisé", threshold: 100 },
  ];

  return (
    <div className="mt-5">
      <div className="relative grid grid-cols-4 gap-2">
        <div className="absolute left-[12.5%] right-[12.5%] top-4 h-px bg-white/10" />
        {steps.map((step, index) => {
          const done = progress >= step.threshold;
          const current = !done && (index === 0 || progress >= steps[index - 1].threshold);
          return (
            <div key={step.label} className="relative flex flex-col items-center gap-2 text-center">
              <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-extrabold ring-1 ${done ? "bg-mapgeo-primary text-white ring-mapgeo-sand/30" : current ? "bg-mapgeo-primary text-white ring-mapgeo-sand/40" : "bg-white/10 text-white/60 ring-white/10"}`}>
                {done ? <CheckCircle2 size={15} /> : index + 1}
              </span>
              <span className="text-[10px] font-bold leading-3 text-white/50">{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

    function SummaryPanel({
      activeFeature,
      clientCode,
      onFocusSelection,
      onOpenPrintOptions,
      onStartInfoEdit,
      canManageParcels = false,
    }) {
  if (!activeFeature) return null;
  const parcel = activeFeature.parcel || {};

  return (
    <div className="space-y-4">
      <DarkCard title="Résumé" icon={ShieldCheck}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-white/40">Surface</p>
            <p className="mt-1 text-base font-extrabold text-white">{activeFeature.areaLabel}</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Référence</p>
            <p className="mt-1 truncate text-base font-extrabold text-white">{parcel.reference || "—"}</p>
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-white/60">Avancement du dossier</span>
            <span className="font-extrabold text-white">{activeFeature.progress}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-mapgeo-sand transition-all duration-500" style={{ width: `${activeFeature.progress}%` }} />
          </div>
        </div>
      </DarkCard>

      <DarkCard title="Actions sur la fiche">
        <button type="button" onClick={onFocusSelection} className="inline-flex w-full items-center justify-center rounded-xl bg-mapgeo-primary px-4 py-3 text-sm font-extrabold text-white transition hover:bg-mapgeo-sand">
          Centrer sur la parcelle
        </button>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link to={`/parcelles/${activeFeature.id}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-3 text-xs font-bold text-white/75 hover:bg-white/10">
            <FolderOpen size={15} /> Ouvrir le dossier
          </Link>
             {canManageParcels ? (
                <button
                  type="button"
                  onClick={onStartInfoEdit}
                  title="Modifier uniquement les informations descriptives et administratives de la parcelle"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-3 text-xs font-bold text-white/75 hover:bg-white/10"
                >
                  <Edit3 size={15} /> Modifier la fiche
                </button>
              ) : null}
          <button type="button" onClick={onOpenPrintOptions} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-3 text-xs font-bold text-white/75 hover:bg-white/10">
            <Printer size={15} /> Imprimer
          </button>
        </div>
      </DarkCard>

      <DarkCard title="Informations clés">
        <div className="space-y-3">
          <InfoRow label="Commune" value={parcel.commune || parcel.location} />
          <InfoRow label="Client" value={parcel.owner_client_code || clientCode} />
          <InfoRow label="Propriétaire" value={parcel.owner_name || "—"} />
          <InfoRow label="Titre foncier" value={parcel.title_number || parcel.land_title} />
          <InfoRow label="Section" value={parcel.section} />
          <InfoRow label="N° parcellaire" value={parcel.parcel_number || parcel.cadastral_number} />
        </div>
      </DarkCard>

      <DarkCard title="Statut de la parcelle" icon={CalendarCheck2}>
        <span className="inline-flex items-center gap-2 rounded-xl bg-mapgeo-sand/20 px-3 py-2 text-xs font-bold text-mapgeo-ivory ring-1 ring-mapgeo-sand/20">
          <CalendarCheck2 size={14} /> {activeFeature.statusLabel}
        </span>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Planifiée le <strong className="ml-2 text-white">{formatDate(parcel.planned_date || parcel.planned_at || parcel.created_at)}</strong>
        </p>
        <ProgressStepper progress={activeFeature.progress} />
      </DarkCard>

      {activeFeature.geometryWarning ? (
        <div className="rounded-2xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 p-4 text-sm leading-6 text-mapgeo-ivory">
          {activeFeature.geometryWarning}
        </div>
      ) : null}
    </div>
  );
}

function AttributesPanel({ activeFeature, clientCode, ownerName }) {
  if (!activeFeature) return null;
  const parcel = activeFeature.parcel || {};
  const vertexRows = buildVertexRows(activeFeature);
  const rows = [
    ["Référence", parcel.reference],
    ["Client", parcel.owner_client_code || clientCode],
    ["Propriétaire", parcel.owner_name || ownerName],
    ["Commune", parcel.commune],
    ["Région", parcel.region],
    ["Adresse", parcel.address || parcel.location || parcel.village],
    ["Surface officielle", activeFeature.officialAreaLabel],
    ["Surface calculée", activeFeature.computedAreaLabel],
    ["Périmètre", activeFeature.perimeterLabel],
    ["Méthode de levé", parcel.method || parcel.survey_method],
    ["Précision GPS", parcel.gps_accuracy || parcel.gps_precision || parcel.accuracy],
    ["Usage foncier", parcel.land_use || parcel.usage],
  ];

  return (
    <div className="space-y-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">{label}</p>
          <p className="mt-1 text-sm font-semibold text-white/80">{value || "—"}</p>
        </div>
      ))}

      <DarkCard title="Coordonnées des sommets">
        <p className="mb-3 text-xs leading-5 text-white/50">
          CRS affiché : {SENEGAL_PROJECTED_CRS} — {SENEGAL_PROJECTED_CRS_LABEL}. Les points Leaflet [lat, lng] sont convertis en X/Y projetés avant affichage.
        </p>
        {vertexRows.length ? (
          <div className="max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/10">
            <div className="grid grid-cols-[minmax(96px,1fr)_minmax(76px,0.9fr)_minmax(76px,0.9fr)] border-b border-white/10 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/40">
              <span>Sommet</span>
              <span className="text-right">X / Easting (m)</span>
              <span className="text-right">Y / Northing (m)</span>
            </div>
            {vertexRows.map((row) => (
              <div key={row.id} className="grid grid-cols-[minmax(96px,1fr)_minmax(76px,0.9fr)_minmax(76px,0.9fr)] gap-2 border-b border-white/10 px-3 py-2.5 text-xs last:border-b-0">
                <span className="truncate font-bold text-white/75">{row.label}</span>
                <span className="text-right font-mono text-white/80">{formatProjectedCoordinate(row.x)}</span>
                <span className="text-right font-mono text-white/80">{formatProjectedCoordinate(row.y)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.025] p-4 text-sm leading-6 text-white/50">
            Aucun sommet renseigné pour cette parcelle.
          </div>
        )}
      </DarkCard>
    </div>
  );
}

function inputDateValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

const INFO_EDIT_PRESERVED_FIELDS = [
  "title_number",
  "parcel_number",
  "section",
  "address",
  "village",
  "department",
  "region",
  "land_use",
  "survey_date",
  "method",
  "orientation",
  "access_info",
  "risk_level",
];

function buildInfoEditForm(activeFeature) {
  const parcel = activeFeature?.parcel || {};
  const officialArea = parcel.area ?? parcel.official_area ?? parcel.declared_area ?? activeFeature?.officialAreaValue ?? "";
  return {
    reference: parcel.reference || "",
    status: normalizeParcelStatus(parcel.status || "created"),
    owner: parcel.owner ? String(parcel.owner) : "",
    organization: parcel.organization ? String(parcel.organization) : "",
    ownerName: parcel.owner_name || "",
    clientCode: parcel.owner_client_code || parcel.organization_code || "",
    area: officialArea === null || officialArea === undefined ? "" : String(officialArea),
    location: parcel.location || "",
    commune: parcel.commune || "",
    createdAt: inputDateValue(parcel.created_at || parcel.created),
    notes: parcel.notes || "",
  };
}

function buildInfoEditPayload(parcel = {}, form = {}) {
  const payload = INFO_EDIT_PRESERVED_FIELDS.reduce((accumulator, key) => {
    if (parcel[key] !== undefined) accumulator[key] = parcel[key];
    return accumulator;
  }, {});

  const parsedArea = form.area === "" ? 0 : Number(form.area);

  payload.reference = form.reference.trim();
  payload.status = form.status;

  if (form.owner !== "") {
    payload.owner = Number(form.owner);
  } else if (parcel.owner !== undefined) {
    payload.owner = parcel.owner;
  }

  if (form.organization !== "") {
    payload.organization = Number(form.organization);
  } else if (parcel.organization !== undefined) {
    payload.organization = parcel.organization;
  }

  payload.area = Number.isNaN(parsedArea) ? 0 : parsedArea;
  payload.location = form.location.trim();
  payload.commune = form.commune.trim();
  payload.notes = form.notes?.trim?.() || "";

  return payload;
}

function ParcelInfoEditPanel({ activeFeature, owners = [], onCancel, onSave }) {
  const parcel = activeFeature?.parcel || {};
  const [form, setForm] = useState(() => buildInfoEditForm(activeFeature));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setForm(buildInfoEditForm(activeFeature));
    setMessage("");
  }, [activeFeature?.id]);

  const selectedOwner = useMemo(
    () => owners.find((owner) => String(owner.id) === String(form.owner)),
    [owners, form.owner],
  );

  const organizationOptions = useMemo(() => selectedOwner?.organizations || [], [selectedOwner]);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  const handleOwnerChange = (value) => {
    const owner = owners.find((item) => String(item.id) === String(value));
    const primaryOrganization = owner?.organizations?.find((organization) => organization.is_primary) || owner?.organizations?.[0];

    setForm((current) => ({
      ...current,
      owner: value,
      organization: primaryOrganization?.id ? String(primaryOrganization.id) : current.organization,
      ownerName: owner?.name || owner?.full_name || owner?.label || current.ownerName,
      clientCode: primaryOrganization?.code || current.clientCode,
    }));
  };

  const handleOrganizationChange = (value) => {
    const organization = organizationOptions.find((item) => String(item.id) === String(value));
    setForm((current) => ({
      ...current,
      organization: value,
      clientCode: organization?.code || current.clientCode,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage("");

    if (!activeFeature?.id) return;
    if (!form.reference.trim()) {
      setMessage("La référence est obligatoire.");
      return;
    }
    if (form.area !== "" && Number.isNaN(Number(form.area))) {
      setMessage("La surface doit être un nombre valide.");
      return;
    }

    const payload = buildInfoEditPayload(parcel, form);

    setSaving(true);
    try {
      await onSave?.(activeFeature.id, payload);
      onCancel?.();
    } catch (error) {
      setMessage(error?.response?.data?.detail || error?.message || "Impossible d’enregistrer les informations de la parcelle.");
    } finally {
      setSaving(false);
    }
  };

  if (!activeFeature) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-3 text-xs font-semibold leading-5 text-mapgeo-ivory/80">
        Modifiez ici uniquement les informations de fiche : référence, statut, propriétaire et données administratives. La géométrie, les sommets et les dimensions se modifient avec l’action <strong>Géométrie</strong> sur la carte.
      </div>

      <label className="block text-[11px] font-bold text-white/60">Référence *
        <input value={form.reference} onChange={(event) => update("reference", event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.065] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60" />
      </label>

      <label className="block text-[11px] font-bold text-white/60">Statut
        <select value={form.status} onChange={(event) => update("status", event.target.value)} className="mapgeo-dark-select mt-1 w-full rounded-xl border border-white/10 bg-[#123B5D] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60">
          {PARCEL_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      {owners.length ? (
        <label className="block text-[11px] font-bold text-white/60">Propriétaire
          <select value={form.owner} onChange={(event) => handleOwnerChange(event.target.value)} className="mapgeo-dark-select mt-1 w-full rounded-xl border border-white/10 bg-[#123B5D] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60">
            <option value="">Sélectionner un propriétaire</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.label || owner.name || owner.full_name || `Propriétaire #${owner.id}`}</option>
            ))}
          </select>
        </label>
      ) : (
        <label className="block text-[11px] font-bold text-white/60">Propriétaire
          <p className="mt-1 w-full rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-sm font-semibold text-white/60 cursor-default select-all">{form.ownerName || "—"}</p>
        </label>
      )}

      {organizationOptions.length ? (
        <label className="block text-[11px] font-bold text-white/60">Client / organisation
          <select value={form.organization} onChange={(event) => handleOrganizationChange(event.target.value)} className="mapgeo-dark-select mt-1 w-full rounded-xl border border-white/10 bg-[#123B5D] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60">
            <option value="">Sélectionner l’organisation cliente</option>
            {organizationOptions.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name} · {organization.code}</option>
            ))}
          </select>
        </label>
      ) : (
        <label className="block text-[11px] font-bold text-white/60">Client
          <p className="mt-1 w-full rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-sm font-semibold text-white/60 cursor-default select-all">{form.clientCode || "—"}</p>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <label className="block text-[11px] font-bold text-white/60">Surface officielle (m²)
          <input type="number" step="0.01" value={form.area} onChange={(event) => update("area", event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.065] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60" />
        </label>
        <label className="block text-[11px] font-bold text-white/60">Créée le
          <p className="mt-1 w-full rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-sm font-semibold text-white/60 cursor-default select-all">{form.createdAt || "—"}</p>
        </label>
      </div>

      <label className="block text-[11px] font-bold text-white/60">Localisation
        <input value={form.location} onChange={(event) => update("location", event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.065] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60" />
      </label>

      <label className="block text-[11px] font-bold text-white/60">Commune
        <input value={form.commune} onChange={(event) => update("commune", event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.065] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60" />
      </label>

      <label className="block text-[11px] font-bold text-white/60">Notes
        <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.065] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60" />
      </label>

      {message ? <p className="rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory">{message}</p> : null}

      <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
        <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-mapgeo-primary px-3 py-2.5 text-sm font-extrabold text-white transition hover:bg-mapgeo-sand disabled:cursor-not-allowed disabled:opacity-55">
          <Save size={15} /> {saving ? "Enregistrement…" : "Enregistrer les informations"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-white/10 px-3 py-2.5 text-sm font-bold text-white/70 transition hover:bg-white/10 disabled:opacity-55">
          Annuler
        </button>
      </div>
    </form>
  );
}

function DocumentsPanel({ documents }) {
  const [message, setMessage] = useState("");
  const [openingId, setOpeningId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const openDocument = async (doc) => {
    if (!doc?.id) return;

    setMessage("");
    setOpeningId(doc.id);

    try {
      const blob = await documentService.downloadDocument(doc.id);
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      setMessage(getErrorMessage(error, "Impossible d’ouvrir ce document."));
    } finally {
      setOpeningId(null);
    }
  };

  const downloadDocument = async (doc) => {
    if (!doc?.id) return;

    setMessage("");
    setDownloadingId(doc.id);

    try {
      const blob = await documentService.downloadDocument(doc.id);
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = doc.title || doc.filename || "document";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      setMessage(getErrorMessage(error, "Impossible de télécharger ce document."));
    } finally {
      setDownloadingId(null);
    }
  };

  if (!documents?.length) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/60">Aucun document lié à cette parcelle.</div>;
  }

  return (
    <div className="space-y-3">
      {message ? <p className="rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory">{message}</p> : null}
      {documents.map((doc) => (
        <div key={doc.id || `${doc.title}-${doc.parcel_reference}`} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="truncate font-bold text-white">{doc.title}</h4>
              <p className="mt-1 text-xs text-white/50">{doc.document_type || "Document"} · {doc.version || "v1"}</p>
            </div>
            {doc.id ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-mapgeo-primary px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={openingId === doc.id || downloadingId === doc.id}
                  onClick={() => openDocument(doc)}
                >
                  {openingId === doc.id ? "Ouverture…" : "Ouvrir"}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-bold text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={openingId === doc.id || downloadingId === doc.id}
                  onClick={() => downloadDocument(doc)}
                >
                  {downloadingId === doc.id ? "Téléchargement…" : "Télécharger"}
                </button>
              </div>
            ) : null}
          </div>
          {doc.description ? <p className="mt-3 text-sm leading-6 text-white/60">{doc.description}</p> : null}
        </div>
      ))}
    </div>
  );
}

function TimelinePanel({ timeline }) {
  if (!timeline?.length) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/60">Aucun jalon disponible.</div>;
  }

  return (
    <div className="space-y-3">
      {timeline.map((event) => (
        <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-start justify-between gap-3">
            <h4 className="font-bold text-white">{event.title}</h4>
            {event.progress !== null && event.progress !== undefined ? (
              <span className="rounded-full bg-mapgeo-sand/20 px-2.5 py-1 text-xs font-bold text-mapgeo-sand">{event.progress}%</span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-white/60">{event.description || "Pas de détail fourni."}</p>
          <p className="mt-3 text-xs text-white/40">{event.date ? formatDate(event.date) : "Date non renseignée"}</p>
        </div>
      ))}
    </div>
  );
}

function TabButton({ active, label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-2 py-3 text-sm font-bold transition ${active ? "text-mapgeo-sand" : "text-white/50 hover:text-white"}`}
    >
      <Icon size={15} /> {label}
      {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-mapgeo-sand" /> : null}
    </button>
  );
}

export default function PortfolioInspector({
  activeFeature,
  activeTab,
  onTabChange,
  clientCode,
  ownerName,
  onFocusSelection,
  onOpenPrintOptions,
  canManageParcels = false,
  onSaveParcelInfo,
  createParcelActive = false,
  createParcelOwners = [],
  createParcelDefaultOwnerId = null,
  onCancelCreateParcel,
  onParcelCreated,
}) {
  const emptyInspector = (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-white/60">
      <p className="font-bold text-white">Aucune parcelle sélectionnée</p>
      <p className="mt-2">Sélectionnez une parcelle dans le panneau de gauche pour afficher sa synthèse, ses attributs, ses documents et ses jalons.</p>
    </div>
  );

  const createInitialValues = useMemo(() => {
    if (!createParcelDefaultOwnerId) return null;
    // Dérive l'organisation depuis la parcelle active si disponible
    // Évite la déduction silencieuse côté backend
    const contextOrg = activeFeature?.parcel?.organization
      || createParcelOwners.find((o) => String(o.id) === String(createParcelDefaultOwnerId))
          ?.organizations?.find((org) => org.is_primary)?.id
      || createParcelOwners.find((o) => String(o.id) === String(createParcelDefaultOwnerId))
          ?.organization_id
      || null;
    return {
      owner: createParcelDefaultOwnerId,
      organization: contextOrg ? String(contextOrg) : "",
    };
  }, [createParcelDefaultOwnerId, activeFeature?.parcel?.organization, createParcelOwners]);
  const [infoEditOpen, setInfoEditOpen] = useState(false);

    const openInfoEdit = () => {
    if (!canManageParcels) return;
    setInfoEditOpen(true);
    };

    useEffect(() => {
    setInfoEditOpen(false);
    }, [activeFeature?.id, createParcelActive, canManageParcels]);

    useEffect(() => {
      if (!canManageParcels && infoEditOpen) {
        setInfoEditOpen(false);
      }
    }, [canManageParcels, infoEditOpen]);

    const panelContent = createParcelActive && canManageParcels ? (
    <ParcelQuickForm
      owners={createParcelOwners}
      initialValues={createInitialValues}
      title=""
      subtitle=""
      submitLabel="Créer"
      onSuccess={onParcelCreated}
      variant="dark"
      compact
    />
  ) : activeFeature
    ? infoEditOpen && canManageParcels
      ? (
        <ParcelInfoEditPanel
          activeFeature={activeFeature}
          owners={createParcelOwners}
          onCancel={() => setInfoEditOpen(false)}
          onSave={onSaveParcelInfo}
        />
      )
      : {
          summary: (
            <SummaryPanel
              activeFeature={activeFeature}
              clientCode={clientCode}
              onFocusSelection={onFocusSelection}
              onOpenPrintOptions={onOpenPrintOptions}
              onStartInfoEdit={openInfoEdit}
              canManageParcels={canManageParcels}
            />
          ),
          attributes: <AttributesPanel activeFeature={activeFeature} clientCode={clientCode} ownerName={ownerName} />,
          documents: <DocumentsPanel documents={activeFeature?.documents || []} />,
          timeline: <TimelinePanel timeline={activeFeature?.timeline || []} />,
        }[activeTab] || null
    : emptyInspector;

  return (
    <aside className="order-3 flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-white/10 bg-[#0c1a28]/96 text-white shadow-[0_24px_80px_rgba(0,0,0,0.28)] lg:col-span-2 min-[1180px]:col-span-1 min-[1180px]:order-3">
      <div className="shrink-0 border-b border-white/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
                        <h3 className="truncate text-lg font-extrabold tracking-tight">
              {createParcelActive && canManageParcels
                ? "Nouvelle parcelle"
                : infoEditOpen && canManageParcels
                  ? "Modifier la fiche parcelle"
                  : activeFeature?.parcel.reference || "Aucune parcelle sélectionnée"}
            </h3>
            <p className="mt-2 truncate text-sm text-white/50">
              {createParcelActive && canManageParcels
                ? "Créer depuis la cartographie"
                : infoEditOpen && canManageParcels
                  ? activeFeature?.parcel.reference || "Fiche parcelle"
                  : activeFeature?.parcel.location || activeFeature?.parcel.commune || "Localisation non renseignée"}
            </p>
          </div>
                    {(createParcelActive && canManageParcels) || (infoEditOpen && canManageParcels) ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createParcelActive ? onCancelCreateParcel : () => setInfoEditOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-xl text-white/50 hover:bg-white/10 hover:text-white"
                aria-label={createParcelActive ? "Fermer la création" : "Fermer l’édition des informations"}
                title={createParcelActive ? "Fermer" : "Fermer l’édition"}
              >
                <X size={18} />
              </button>
            </div>
          ) : null}
        </div>

                {activeFeature && !(createParcelActive && canManageParcels) && !(infoEditOpen && canManageParcels) ? (
          <div className="mt-4 flex items-center gap-4 overflow-x-auto">
            <TabButton active={activeTab === "summary"} icon={ShieldCheck} label="Synthèse" onClick={() => onTabChange("summary")} />
            <TabButton active={activeTab === "attributes"} icon={FileText} label="Attributs" onClick={() => onTabChange("attributes")} />
            <TabButton active={activeTab === "documents"} icon={FileText} label="Documents" onClick={() => onTabChange("documents")} />
            <TabButton active={activeTab === "timeline"} icon={Route} label="Jalons" onClick={() => onTabChange("timeline")} />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">{panelContent}</div>
    </aside>
  );
}
