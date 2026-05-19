import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  FileText,
  FolderKanban,
  History,
  Layers,
  Loader2,
  MapPinned,
  Ruler,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { getParcelStatusLabel, progressFromStatus } from "../constants/parcelConstants";
import useParcels from "../hooks/useParcels";
import DashboardLayout from "../layouts/DashboardLayout";
import { getErrorMessage, isNotFoundError } from "../services/responseUtils";
import { formatDateLabel as safeFormatDateLabel } from "../utils/dateUtils";
import { exportParcelDetailPdf } from "../utils/parcelPdfExport";

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function hasDisplayValue(value) {
  return hasValue(value) && String(value).trim() !== "—";
}

function visibleRows(rows) {
  return rows.filter((row) => hasDisplayValue(row.value));
}

function formatNumber(value, options = {}) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return new Intl.NumberFormat("fr-FR", options).format(numericValue);
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;
  }

  for (const value of values) {
    if (hasValue(value)) return value;
  }

  return null;
}

function formatArea(value) {
  const numericValue = Number(value || 0);
  if (!numericValue) return "—";
  return `${formatNumber(numericValue, { maximumFractionDigits: 2 })} m²`;
}

function formatLength(value) {
  const numericValue = Number(value || 0);
  if (!numericValue) return "—";
  return `${formatNumber(numericValue, { maximumFractionDigits: 2 })} m`;
}

function formatCoordinate(value, decimals = 3) {
  if (!hasValue(value)) return "—";
  return formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function formatProgress(value) {
  if (!hasValue(value)) return "—";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return `${formatNumber(numericValue, { maximumFractionDigits: 0 })} %`;
}

function formatDate(value) {
  return safeFormatDateLabel(value, "—", { day: "2-digit", month: "long", year: "numeric" });
}

function buildParcelCartoHref(parcel, returnTo) {
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  if (parcel?.organization_code) params.set("organization_code", parcel.organization_code);
  if (parcel?.organization_id || parcel?.organization) params.set("organization_id", parcel.organization_id || parcel.organization);
  if (parcel?.owner_client_code) params.set("owner_client_code", parcel.owner_client_code);
  const query = params.toString();
  return `/parcelles/${parcel.id}/carto${query ? `?${query}` : ""}`;
}

function StateCard({ tone = "default", title, message, actions = null }) {
  const isLoading = tone === "loading";
  const toneClass =
    tone === "error"
      ? "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary"
      : isLoading
        ? "border-mapgeo-line bg-white text-mapgeo-primary"
        : "border-mapgeo-line bg-white text-mapgeo-secondary";

  return (
    <div className={`flex h-full min-h-[520px] items-center justify-center rounded-3xl border px-6 py-10 shadow-soft ${toneClass}`}>
      <div className="max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
          {isLoading ? <Loader2 size={22} className="animate-spin" /> : <AlertCircle size={22} />}
        </div>
        <h2 className="text-xl font-extrabold text-mapgeo-primary">{title}</h2>
        <p className="mt-3 text-sm leading-6 opacity-90">{message}</p>
        {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}

function MissingParcelState({ id }) {
  return (
    <StateCard
      tone="error"
      title="Parcelle introuvable"
      message={`Aucune parcelle n’a été trouvée pour l’identifiant ${id}. Vérifie la référence ou retourne à la liste des parcelles.`}
      actions={
        <Link
          to="/parcelles"
          className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
        >
          <ArrowLeft size={16} /> Retour aux parcelles
        </Link>
      }
    />
  );
}

function ParcelHeader({ parcel, returnTo }) {
  const ownerLabel = parcel.owner_name || parcel.owner_client_code || "Client";
  const locationLabel = parcel.location || parcel.commune || parcel.village || "Sans localisation";
  const cartoHref = buildParcelCartoHref(parcel, returnTo);

  return (
    <div className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Link
            to="/parcelles"
            className="inline-flex w-fit items-center gap-2 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory px-4 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-white"
          >
            <ArrowLeft size={16} /> Retour aux parcelles
          </Link>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-mapgeo-secondary/60">
              Fiche parcellaire
            </p>
            <h2 className="mt-2 text-3xl font-extrabold text-mapgeo-primary">
              {parcel.reference || parcel.title_number || `Parcelle ${parcel.id}`}
            </h2>
            <p className="mt-2 text-sm text-mapgeo-secondary/75">{locationLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to={cartoHref}
            className="inline-flex items-center gap-2 rounded-2xl bg-mapgeo-primary px-4 py-3 text-sm font-bold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
          >
            <MapPinned size={16} /> Visualiser sur la carte
          </Link>

          <button
            type="button"
            onClick={() => exportParcelDetailPdf(parcel)}
            className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
          >
            <FileText size={16} /> Télécharger la fiche PDF
          </button>

          <span className="inline-flex items-center gap-2 rounded-full border border-mapgeo-line bg-white px-3 py-2 text-sm font-bold text-mapgeo-primary">
            <FolderKanban size={16} /> {getParcelStatusLabel(parcel.status)}
          </span>

          <span className="inline-flex items-center gap-2 rounded-full border border-mapgeo-line bg-white px-3 py-2 text-sm font-bold text-mapgeo-primary">
            <ShieldCheck size={16} /> {ownerLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }) {
  return (
    <article className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
          <Icon size={21} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-secondary/60">
            {label}
          </p>
          <p className="mt-2 truncate text-xl font-extrabold text-mapgeo-primary">
            {hasValue(value) ? value : "—"}
          </p>
        </div>
      </div>
    </article>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col gap-1 border-b border-mapgeo-line py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-semibold text-mapgeo-secondary/70">{label}</span>
      <strong className="text-sm text-mapgeo-primary sm:text-right">{hasValue(value) ? value : "—"}</strong>
    </div>
  );
}

function ParcelDocumentsSection({ documents = [] }) {
  if (!documents.length) {
    return (
      <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
        <h3 className="flex items-center gap-2 text-xl font-extrabold text-mapgeo-primary">
          <FileText size={19} /> Plans, rapports et livrables
        </h3>
        <p className="mt-3 text-sm leading-6 text-mapgeo-secondary/70">
          Aucun plan, rapport ou livrable visible n’est rattaché à cette parcelle.
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
      <h3 className="flex items-center gap-2 text-xl font-extrabold text-mapgeo-primary">
        <FileText size={19} /> Plans, rapports et livrables liés
      </h3>
      <p className="mt-2 text-sm text-mapgeo-secondary/70">
        {documents.length} livrable(s) visible(s) pour votre profil.
      </p>

      <div className="mt-4 space-y-3">
        {documents.map((doc) => (
          <Link
            key={doc.id}
            to={`/documents/${doc.id}`}
            className="block rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 px-4 py-3 transition hover:bg-white"
          >
            <p className="text-sm font-extrabold text-mapgeo-primary">{doc.title || `Livrable ${doc.id}`}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-mapgeo-secondary/55">
              {doc.document_type || "Livrable"} · {doc.status || "—"} · version {doc.version || "v1"}
            </p>
          </Link>
        ))}
      </div>
    </article>
  );
}

function ParcelTimelineSection({ events = [] }) {
  if (!events.length) {
    return null;
  }

  const sortedEvents = [...events].sort((a, b) => new Date(b.event_date || 0) - new Date(a.event_date || 0));

  return (
    <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
      <h3 className="flex items-center gap-2 text-xl font-extrabold text-mapgeo-primary">
        <History size={19} /> Historique d’avancement
      </h3>

      <div className="mt-4 space-y-3">
        {sortedEvents.map((event) => (
          <div key={event.id} className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 px-4 py-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-extrabold text-mapgeo-primary">{event.title || "Évènement"}</p>
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-mapgeo-secondary/55">
                {formatDate(event.event_date)} · {formatProgress(event.progress)}
              </span>
            </div>
            {event.description ? (
              <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/70">{event.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function ParcelBoundariesSection({ sides = [] }) {
  if (!sides.length) {
    return null;
  }

  return (
    <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
      <h3 className="flex items-center gap-2 text-xl font-extrabold text-mapgeo-primary">
        <Layers size={19} /> Limites et côtés
      </h3>

      <div className="mt-4 overflow-hidden rounded-2xl border border-mapgeo-line">
        <table className="min-w-full divide-y divide-mapgeo-line text-sm">
          <thead className="bg-mapgeo-ivory/70 text-left text-xs font-bold uppercase tracking-[0.14em] text-mapgeo-secondary/60">
            <tr>
              <th className="px-4 py-3">Côté</th>
              <th className="px-4 py-3">Longueur</th>
              <th className="px-4 py-3">État limite</th>
              <th className="px-4 py-3">Vérifié le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mapgeo-line bg-white">
            {sides.map((side) => (
              <tr key={side.id || side.label}>
                <td className="px-4 py-3 font-bold text-mapgeo-primary">{side.label || "—"}</td>
                <td className="px-4 py-3 text-mapgeo-secondary/75">{formatLength(side.length)}</td>
                <td className="px-4 py-3 text-mapgeo-secondary/75">{side.boundary_state || "—"}</td>
                <td className="px-4 py-3 text-mapgeo-secondary/75">{formatDate(side.verification_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ParcelDetailContent({ parcel, returnTo }) {
  const ownerLabel = parcel.owner_name || parcel.owner_client_code || "—";
  const organizationLabel = parcel.organization_name || parcel.organization_code || "—";
  const locationLabel = parcel.location || parcel.commune || parcel.village || "—";
  const cartoHref = buildParcelCartoHref(parcel, returnTo);
  const effectiveArea = firstPositiveNumber(parcel.area, parcel.computed_area);
  const effectivePerimeter = firstPositiveNumber(parcel.perimeter, parcel.computed_perimeter);
  const projectedX = parcel.centroid_easting ?? parcel.centroid_x ?? null;
  const projectedY = parcel.centroid_northing ?? parcel.centroid_y ?? null;

  const identityRows = visibleRows([
    { label: "Référence", value: parcel.reference },
    { label: "Titre foncier", value: parcel.title_number || parcel.land_title },
    { label: "Numéro parcellaire", value: parcel.parcel_number || parcel.cadastral_number },
    { label: "Section", value: parcel.section },
    { label: "Propriétaire", value: ownerLabel },
    { label: "Organisation", value: organizationLabel },
  ]);

  const locationRows = visibleRows([
    { label: "Commune", value: parcel.commune },
    { label: "Département", value: parcel.department },
    { label: "Région", value: parcel.region },
    { label: "Village / zone", value: parcel.village },
    { label: "Adresse / Localisation", value: parcel.address || parcel.location },
  ]);

  const technicalRows = visibleRows([
    { label: "Usage foncier", value: parcel.land_use || parcel.usage },
    { label: "Méthode de levé", value: parcel.method || parcel.survey_method },
    { label: "Date de levé", value: formatDate(parcel.survey_date) },
    { label: "Orientation", value: parcel.orientation },
    { label: "Accès", value: parcel.access_info },
    { label: "Niveau de risque", value: parcel.risk_level },
    { label: "Créée le", value: formatDate(parcel.created_at) },
    { label: "Mise à jour le", value: formatDate(parcel.updated_at) },
  ]);

  const measureRows = visibleRows([
    { label: "Surface", value: formatArea(effectiveArea) },
    { label: "Périmètre", value: formatLength(effectivePerimeter) },
    { label: "CRS", value: parcel.crs },
    { label: "X / Easting", value: formatCoordinate(projectedX) },
    { label: "Y / Northing", value: formatCoordinate(projectedY) },
    { label: "Latitude", value: formatCoordinate(parcel.centroid_lat, 6) },
    { label: "Longitude", value: formatCoordinate(parcel.centroid_lon, 6) },
  ]);

  const hasDetails = identityRows.length || locationRows.length || technicalRows.length;

  return (
    <div className="space-y-6">
      <ParcelHeader parcel={parcel} returnTo={returnTo} />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <InfoCard icon={FolderKanban} label="Avancement" value={getParcelStatusLabel(parcel.status)} />
        <InfoCard icon={UserRound} label="Propriétaire" value={ownerLabel} />
        <InfoCard icon={ShieldCheck} label="Organisation" value={organizationLabel} />
        <InfoCard icon={MapPinned} label="Localisation" value={locationLabel} />
        <InfoCard icon={CalendarDays} label="Avancement" value={formatProgress(parcel.progress ?? progressFromStatus(parcel.status))} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">
            Fiche de la parcelle
          </h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            Seules les informations utiles sont affichées afin de garder votre dossier lisible.
          </p>

          {hasDetails ? (
            <div className="mt-5 space-y-5">
              {identityRows.length ? (
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-[0.16em] text-mapgeo-secondary/60">Identification</h4>
                  <div className="mt-2 rounded-2xl border border-mapgeo-line px-4">
                    {identityRows.map((row) => <DetailRow key={row.label} {...row} />)}
                  </div>
                </div>
              ) : null}

              {locationRows.length ? (
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-[0.16em] text-mapgeo-secondary/60">Localisation</h4>
                  <div className="mt-2 rounded-2xl border border-mapgeo-line px-4">
                    {locationRows.map((row) => <DetailRow key={row.label} {...row} />)}
                  </div>
                </div>
              ) : null}

              {technicalRows.length ? (
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-[0.16em] text-mapgeo-secondary/60">Compléments</h4>
                  <div className="mt-2 rounded-2xl border border-mapgeo-line px-4">
                    {technicalRows.map((row) => <DetailRow key={row.label} {...row} />)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/40 p-4 text-sm text-mapgeo-secondary/70">
              Aucune information complémentaire n’est renseignée pour cette parcelle.
            </div>
          )}
        </article>

        <aside className="space-y-4">
          <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
            <h3 className="flex items-center gap-2 text-xl font-extrabold text-mapgeo-primary">
              <Ruler size={19} /> Mesures
            </h3>

            {measureRows.length ? (
              <div className="mt-4 rounded-2xl border border-mapgeo-line px-4">
                {measureRows.map((row) => <DetailRow key={row.label} {...row} />)}
              </div>
            ) : (
              <p className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/40 p-4 text-sm text-mapgeo-secondary/70">
                Aucune mesure calculée n’est disponible pour cette parcelle.
              </p>
            )}
          </article>

          <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
            <h3 className="text-xl font-extrabold text-mapgeo-primary">Accès rapide</h3>

            <div className="mt-4 space-y-3">
              <Link
                to={cartoHref}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
              >
                <MapPinned size={17} /> Visualiser sur la carte
              </Link>

              <Link
                to="/parcelles"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
              >
                <ArrowLeft size={17} /> Retour à la liste
              </Link>
            </div>
          </article>

          <ParcelDocumentsSection documents={parcel.documents || []} />
        </aside>
      </section>

      <ParcelTimelineSection events={parcel.timeline_events || []} />
      <ParcelBoundariesSection sides={parcel.sides || []} />

      {parcel.notes ? (
        <article className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
          <h3 className="text-xl font-extrabold text-mapgeo-primary">Notes</h3>
          <p className="mt-3 text-sm leading-6 text-mapgeo-secondary">{parcel.notes}</p>
        </article>
      ) : null}
    </div>
  );
}

export default function ParcelleDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ""}`;
  const { selectedParcel, fetchParcelById, loadingDetail } = useParcels();
  const [fetchError, setFetchError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const fetchParcelRef = useRef(fetchParcelById);

  useEffect(() => {
    fetchParcelRef.current = fetchParcelById;
  }, [fetchParcelById]);

  const isCurrentParcel = selectedParcel && id ? String(selectedParcel.id) === String(id) : false;

  useEffect(() => {
    if (!id) {
      setFetchError("Identifiant de parcelle manquant.");
      setNotFound(false);
      return;
    }

    let active = true;

    setFetchError("");
    setNotFound(false);

    Promise.resolve(fetchParcelRef.current(id)).catch((error) => {
      if (!active) return;
      setNotFound(isNotFoundError(error));
      setFetchError(getErrorMessage(error, "Erreur lors du chargement de la parcelle."));
    });

    return () => {
      active = false;
    };
  }, [id]);

  const innerContent = (() => {
    if (!id) {
      return (
        <StateCard
          title="Identifiant manquant"
          message="Aucun identifiant de parcelle n’a été fourni dans l’URL."
          tone="error"
        />
      );
    }

    if (loadingDetail && !isCurrentParcel) {
      return <StateCard tone="loading" title="Veuillez patienter" message="Ouverture du dossier parcelle." />;
    }

    if (notFound) {
      return <MissingParcelState id={id} />;
    }

    if (fetchError) {
      return (
        <StateCard
          title="Erreur de chargement"
          message={fetchError}
          tone="error"
          actions={
            <Link
              to="/parcelles"
              className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
            >
              <ArrowLeft size={16} /> Retour aux parcelles
            </Link>
          }
        />
      );
    }

    if (!selectedParcel || !isCurrentParcel) {
      return <MissingParcelState id={id} />;
    }

    return <ParcelDetailContent parcel={selectedParcel} returnTo={returnTo} />;
  })();

  return (
    <DashboardLayout
      title="Fiche parcellaire"
      subtitle="Consultez les informations administratives de la parcelle et ouvrez la cartographie dédiée si nécessaire."
    >
      {innerContent}
    </DashboardLayout>
  );
}
