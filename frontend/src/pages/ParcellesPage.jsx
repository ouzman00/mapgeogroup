import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  Layers3,
  Map,
  MapPin,
  Pencil,
  RefreshCcw,
  Search,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import useParcels from "../hooks/useParcels";
import parcelService from "../services/parcelService";
import { fetchAllClients } from "../services/clientService";
import { getErrorMessage } from "../services/responseUtils";
import {
  PARCEL_STATUS_OPTIONS,
  getParcelStatusClasses,
  getParcelStatusLabel,
  progressFromStatus,
} from "../constants/parcelConstants";
import { formatDateLabel } from "../utils/dateUtils";

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function formatArea(value) {
  const numericValue = Number(value || 0);
  if (!numericValue) return "—";
  return `${formatNumber(numericValue)} m²`;
}

function formatDate(value) {
  return formatDateLabel(value);
}


function normalizeStatusLabel(parcel) {
  if (parcel.status_label) return parcel.status_label;
  return getParcelStatusLabel(parcel.status);
}

function statusClasses(status) {
  return getParcelStatusClasses(status);
}


function progressClasses(value) {
  if (value >= 95) return "bg-mapgeo-primary";
  if (value >= 60) return "bg-mapgeo-primary";
  if (value >= 35) return "bg-mapgeo-sand";
  return "bg-mapgeo-primary/70";
}

function buildParcelQueryParams(filters = {}) {
  const params = {};
  const q = String(filters.q || "").trim();
  const organizationCode = String(filters.organization_code || "").trim();
  const ownerClientCode = String(filters.owner_client_code || "").trim();
  const commune = String(filters.commune || "").trim();
  const status = String(filters.status || "").trim();

  if (q) params.q = q;
  if (organizationCode) params.organization_code = organizationCode;
  if (ownerClientCode) params.owner_client_code = ownerClientCode;
  if (commune) params.commune = commune;
  if (status) params.status = status;

  return params;
}

function buildCartoHref(filters = {}, returnTo = "") {
  const params = new URLSearchParams();
  const q = String(filters.q || "").trim();
  const organizationCode = String(filters.organization_code || "").trim();
  const ownerClientCode = String(filters.owner_client_code || "").trim();
  const commune = String(filters.commune || "").trim();
  const status = String(filters.status || "").trim();

  if (q) params.set("q", q);
  if (organizationCode) params.set("organization_code", organizationCode);
  if (ownerClientCode) params.set("owner_client_code", ownerClientCode);
  if (commune) params.set("commune", commune);
  if (status) params.set("status", status);
  if (returnTo) params.set("returnTo", returnTo);

  const queryString = params.toString();
  return queryString ? `/parcelles/carto?${queryString}` : "/parcelles/carto";
}

function clientOptionValue(client = {}) {
  return String(client.code || client.primary_user_client_code || client.client_code || "").trim();
}

function clientOptionLabel(client = {}) {
  const name = String(client.name || client.company_name || "").trim();
  const code = clientOptionValue(client);
  if (name && code) return `${name} · ${code}`;
  return name || code || "Client";
}

function buildParcelMapHref(parcel, filters = {}, returnTo = "") {
  const params = new URLSearchParams(buildParcelQueryParams(filters));
  if (returnTo) params.set("returnTo", returnTo);
  const queryString = params.toString();
  const base = parcel?.id ? `/parcelles/${parcel.id}/carto` : "/parcelles/carto";
  return queryString ? `${base}?${queryString}` : base;
}

function getImportSummary(job = {}) {
  const summary = job.summary || {};
  return {
    status: job.status || "",
    created: Number(summary.created || 0),
    updated: Number(summary.updated || 0),
    errors: Number(summary.error_rows || 0),
    validated: Number(summary.validated_rows || 0),
    detail: job.error_message || "",
  };
}

function formatImportResultMessage(job = {}) {
  const { status, created, updated, errors, validated, detail } = getImportSummary(job);
  const processed = created + updated;

  if (status === "failed") {
    return detail ? `Import échoué : ${detail}` : "Import échoué. Vérifiez le fichier CSV.";
  }

  if (errors > 0 && processed > 0) {
    return `Import partiel : ${formatNumber(created)} créée(s), ${formatNumber(updated)} mise(s) à jour, ${formatNumber(errors)} ligne(s) en erreur.`;
  }

  if (errors > 0 && processed === 0) {
    return `Import non exécuté : ${formatNumber(errors)} ligne(s) en erreur sur ${formatNumber(validated + errors)}.`;
  }

  return `Import CSV terminé : ${formatNumber(created)} créée(s), ${formatNumber(updated)} mise(s) à jour.`;
}

function KpiCard({ icon: Icon, label, value, description, action, href, tone = "blue" }) {
  const tones = {
    blue: "bg-mapgeo-sand/15 text-mapgeo-primary",
    purple: "bg-mapgeo-sand/15 text-mapgeo-primary",
    green: "bg-mapgeo-primary/6 text-mapgeo-primary",
    amber: "bg-mapgeo-sand/10 text-mapgeo-primary",
  };

  return (
    <article className="group rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft transition hover:border-mapgeo-sand/50">
      <div className="flex items-start gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tones[tone] || tones.blue}`}>
          <Icon size={27} strokeWidth={1.9} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-mapgeo-secondary/70">
            {label}
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-mapgeo-primary">
            {value}
          </p>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-mapgeo-line pt-4">
        <Link
          to={href || "/parcelles"}
          className="inline-flex items-center gap-2 text-sm font-bold text-mapgeo-primary transition group-hover:gap-3"
        >
          {action} <ChevronRight size={16} />
        </Link>
      </div>
    </article>
  );
}

function FilterBar({ values, clients, onChange, onReset, showClientFilter = true }) {
  const updateField = (name, value) => {
    onChange?.({ ...values, [name]: value });
  };

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-4 shadow-soft">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-[1.45fr_1fr_1fr_1fr_auto]">
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-mapgeo-primary/80">Recherche</span>
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm focus-within:border-mapgeo-primary/40 focus-within:ring-4 focus-within:ring-mapgeo-primary/5">
            <Search size={16} className="text-mapgeo-secondary/60" />
            <input
              value={values.q}
              onChange={(event) => updateField("q", event.target.value)}
              placeholder="Référence, client, commune..."
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
            />
          </div>
        </label>

        {showClientFilter ? (
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-mapgeo-primary/80">Client</span>
            <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
              <UserRound size={16} className="text-mapgeo-secondary/60" />
              <select
                value={values.organization_code}
                onChange={(event) => updateField("organization_code", event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
              >
                <option value="">Tous les clients</option>
                {clients.map((client) => (
                  <option
                    key={clientOptionValue(client) || client.id || client.name}
                    value={clientOptionValue(client)}
                  >
                    {clientOptionLabel(client)}
                  </option>
                ))}
              </select>
            </div>
          </label>
        ) : null}

        <label className="space-y-1.5">
          <span className="text-xs font-bold text-mapgeo-primary/80">Commune</span>
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
            <MapPin size={16} className="text-mapgeo-secondary/60" />
            <input
              value={values.commune}
              onChange={(event) => updateField("commune", event.target.value)}
              placeholder="Toutes les communes"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
            />
          </div>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-bold text-mapgeo-primary/80">Statut</span>
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
            <ShieldCheck size={16} className="text-mapgeo-secondary/60" />
            <select
              value={values.status}
              onChange={(event) => updateField("status", event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
            >
              <option value="">Tous les statuts</option>
              {PARCEL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 text-sm font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory 2xl:w-auto"
          >
            <RefreshCcw size={16} /> Réinitialiser
          </button>
        </div>
      </div>
    </section>
  );
}

function ParcelTable({ rows, loading, error, showClientColumn = true, returnTo = "/parcelles" }) {
  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-mapgeo-line p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">Liste des parcelles</h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            Suivi opérationnel des parcelles du portefeuille.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-mapgeo-secondary">
          Chargement des parcelles…
        </div>
      ) : null}

      {error ? (
        <div className="m-6 rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm font-medium text-mapgeo-primary">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
                <th className="px-5 py-4">Référence</th>
                {showClientColumn ? <th className="px-4 py-4">Client</th> : null}
                <th className="px-4 py-4">Commune</th>
                <th className="px-4 py-4">Surface</th>
                <th className="px-4 py-4">Statut</th>
                <th className="px-4 py-4">Avancement</th>
                <th className="px-4 py-4">Dernière mise à jour</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-mapgeo-line">
              {rows.map((row) => (
                <tr key={row.id} className="transition hover:bg-mapgeo-ivory/40">
                  <td className="px-5 py-4 font-extrabold text-mapgeo-primary">
                    {row.reference}
                  </td>

                  {showClientColumn ? (
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${row.accent} text-xs font-extrabold text-white shadow-sm`}>
                          {row.client?.[0] || "C"}
                        </span>
                        <span className="font-semibold text-mapgeo-primary">{row.client}</span>
                      </div>
                    </td>
                  ) : null}

                  <td className="px-4 py-4 text-mapgeo-secondary">{row.commune}</td>
                  <td className="px-4 py-4 font-semibold text-mapgeo-primary">{formatArea(row.area)}</td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${statusClasses(row.status)}`}>
                      {row.status}
                    </span>
                  </td>

                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <span className="w-10 text-xs font-bold text-mapgeo-primary">
                        {row.progress}%
                      </span>
                      <span className="h-2 w-24 overflow-hidden rounded-full bg-mapgeo-ivory">
                        <span
                          className={`block h-full rounded-full ${progressClasses(row.progress)}`}
                          style={{ width: `${Math.min(row.progress, 100)}%` }}
                        />
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-4 text-mapgeo-secondary">{row.updatedAt}</td>

                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={row.href}
                        className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory"
                      >
                        Ouvrir
                      </Link>

                      <Link
                        to={row.cartoHref}
                        state={{ returnTo }}
                        className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory"
                      >
                        Carte
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows.length ? (
            <div className="p-6 text-center text-sm text-mapgeo-secondary">
              Aucune parcelle trouvée.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SummaryMetric({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={17} className="text-white/70" />
      <span className="flex-1 text-white/80">{label}</span>
      <span className="font-extrabold text-white">{value}</span>
    </div>
  );
}

function ParcelSummary({ total, rows, onSelectAlert, isInternalPortal }) {
  const totalSurface = rows.reduce((sum, row) => sum + Number(row.area || 0), 0);
  const communes = new Set(rows.map((row) => row.commune).filter(Boolean));

  const alerts = [
    { label: "Parcelles en vérification", filter: { status: "to_verify" } },
    { label: "Parcelles bloquées", filter: { status: "disputed" } },
    ...(isInternalPortal ? [{ label: "Imports à valider", href: "#import-csv" }] : []),
  ];

  return (
    <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl" />

      <div className="relative">
        <h3 className="text-sm font-extrabold text-white">Résumé parcellaire</h3>

        <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
          <SummaryMetric icon={Map} label="Total parcelles" value={formatNumber(total)} />
          <SummaryMetric icon={MapPin} label="Communes chargées" value={formatNumber(communes.size)} />
          <SummaryMetric icon={CalendarDays} label="Surface chargée" value={`${formatNumber(totalSurface)} m²`} />
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-extrabold text-white">Alertes</h4>

          <div className="mt-3 space-y-3">
            {alerts.map((alert) => {
              const content = (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-mapgeo-sand" />
                  <span className="flex-1">{alert.label}</span>
                  <ChevronRight size={16} className="text-white/60" />
                </>
              );

              const className = "flex w-full items-center gap-3 rounded-2xl py-1.5 text-left text-sm font-semibold text-white/90 transition hover:bg-white/5";

              if (alert.href) {
                return (
                  <a key={alert.label} href={alert.href} className={className}>
                    {content}
                  </a>
                );
              }

              return (
                <button
                  key={alert.label}
                  type="button"
                  onClick={() => onSelectAlert?.(alert.filter)}
                  className={className}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

function CsvImportPanel({ owners, canManageParcels, onImported }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [defaultOwnerId, setDefaultOwnerId] = useState("");
  const [skipErrors, setSkipErrors] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canManageParcels) {
      setMessage("Vous n’avez pas les droits nécessaires pour importer des parcelles.");
      return;
    }

    if (!selectedFile) {
      setMessage("Sélectionne d’abord un fichier CSV à importer.");
      return;
    }

    if (!defaultOwnerId) {
      setMessage("Sélectionne un propriétaire client : il permet de rattacher l’import à une organisation autorisée.");
      return;
    }

    const selectedOwner = owners.find((owner) => String(owner.id) === String(defaultOwnerId));
    const organization = selectedOwner?.organization_id || selectedOwner?.organizations?.[0]?.id || "";
    if (!organization) {
      setMessage("Le propriétaire sélectionné n’est rattaché à aucune organisation client active. Import bloqué.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const importOptions = { organization, skip_errors: skipErrors ? "true" : "false" };

      const job = await parcelService.createImportJob(selectedFile, defaultOwnerId, importOptions);
      const validatedJob = await parcelService.validateImportJob(job.id);
      const validationSummary = getImportSummary(validatedJob);

      if (validationSummary.errors > 0 && !skipErrors) {
        setMessage(formatImportResultMessage(validatedJob));
        return;
      }

      const executedJob = await parcelService.executeImportJob(validatedJob.id);

      setSelectedFile(null);
      setDefaultOwnerId("");
      setSkipErrors(false);
      setMessage(formatImportResultMessage(executedJob));

      await onImported?.();
    } catch (error) {
      setMessage(getErrorMessage(error, "Import CSV impossible."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div>
        <h3 className="text-xl font-extrabold text-mapgeo-primary">Importer des parcelles CSV</h3>
        <p className="mt-1 text-sm text-mapgeo-secondary/70">
          Importez un fichier CSV contenant plusieurs parcelles. En mode strict, l'import est bloqué si une ligne est invalide. En mode souple, les lignes valides sont importées et les erreurs signalées. Le propriétaire choisi doit être rattaché à une organisation client active.</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <label className="flex min-h-[118px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-mapgeo-sand/60 bg-mapgeo-sand/15 px-4 py-5 text-center transition hover:bg-mapgeo-sand/15">
          <Upload size={26} className="text-mapgeo-primary" />
          <span className="mt-2 text-sm font-semibold text-mapgeo-primary">
            {selectedFile ? selectedFile.name : "Glissez-déposez votre fichier ici"}
          </span>
          <span className="text-xs text-mapgeo-secondary/70">ou cliquez pour parcourir</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
          />
        </label>

        {owners.length ? (
          <select
            value={defaultOwnerId}
            onChange={(event) => setDefaultOwnerId(event.target.value)}
            className="w-full rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm outline-none"
          >
            <option value="">Sélectionner un propriétaire client obligatoire</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.label}
              </option>
            ))}
          </select>
        ) : null}

        {message ? (
          <p className="rounded-2xl bg-mapgeo-ivory px-3 py-2 text-sm text-mapgeo-secondary">
            {message}
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-mapgeo-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipErrors}
            onChange={(e) => setSkipErrors(e.target.checked)}
            className="rounded border-mapgeo-line"
          />
          Mode souple — importer les lignes valides, signaler les erreurs sans bloquer
        </label>

        <button
          type="submit"
          disabled={loading || !canManageParcels}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload size={17} /> {loading ? "Import en cours..." : "Importer un fichier"}
        </button>
      </form>
    </section>
  );
}

function buildRows(parcels, filters = {}, returnTo = "") {
  if (!parcels.length) return [];

  return parcels.map((parcel, index) => {
    const status = normalizeStatusLabel(parcel);
    const progress = Number(parcel.progress ?? progressFromStatus(parcel.status) ?? 0);
    const client = parcel.organization_name || parcel.owner_name || parcel.owner_client_code || "Client";

    return {
      id: parcel.id || `parcel-${index}`,
      reference: parcel.reference || parcel.title_number || `MAP-${String(index + 1).padStart(3, "0")}`,
      client,
      commune: parcel.commune || parcel.location || parcel.village || "—",
      region: parcel.region || "—",
      area: parcel.area || 0,
      status,
      progress,
      updatedAt: formatDate(parcel.updated_at || parcel.created_at),
      href: parcel.id ? `/parcelles/${parcel.id}` : "/parcelles",
      cartoHref: buildParcelMapHref(parcel, filters, returnTo),
      accent: "bg-mapgeo-primary",
    };
  });
}

export default function ParcellesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = `${location.pathname}${location.search || ""}`;
  const {
    parcels,
    listMeta,
    fetchParcels,
    fetchOwners,
    owners,
    loadingList,
  } = useParcels();

  const { user, isClientPortal, isInternalPortal } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [error, setError] = useState("");

  const canManageParcels = isInternalPortal && ["admin", "manager"].includes(user?.role);
  const canImportParcels = isInternalPortal && ["admin", "manager"].includes(user?.role);

  const queryState = useMemo(
    () => ({
      q: searchParams.get("q") || "",
      organization_code: searchParams.get("organization_code") || searchParams.get("client") || "",
      owner_client_code: searchParams.get("owner_client_code") || "",
      commune: searchParams.get("commune") || searchParams.get("location") || "",
      status: searchParams.get("status") || "",
    }),
    [searchParams],
  );

  const loadParcels = async (nextQuery = queryState) => {
    setError("");

    try {
      await fetchParcels(buildParcelQueryParams(nextQuery));
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Impossible de charger les parcelles."));
    }
  };

  useEffect(() => {
    loadParcels(queryState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryState.q, queryState.status, queryState.commune, queryState.organization_code, queryState.owner_client_code]);

  useEffect(() => {
    if (!isInternalPortal) return;

    if (canImportParcels) {
      fetchOwners().catch(() => {});
    }

    fetchAllClients({ ordering: "name" })
      .then((payload) => setClients(payload.results || []))
      .catch(() => setClients([]));
  }, [canImportParcels, fetchOwners, isInternalPortal]);

  const rows = useMemo(() => buildRows(parcels, queryState, returnTo), [parcels, queryState, returnTo]);
  const totalParcels = listMeta?.count || rows.length;

  const verificationCount = rows.filter((row) =>
    row.status.toLowerCase().includes("vérif")
  ).length;

  const validCount = rows.filter((row) =>
    row.status.toLowerCase().includes("termin") ||
    row.status.toLowerCase().includes("valid") ||
    row.progress >= 100
  ).length;

  const blockedCount = rows.filter((row) =>
    row.status.toLowerCase().includes("litige") ||
    row.status.toLowerCase().includes("bloqu")
  ).length;

  const kpis = [
    {
      icon: Map,
      label: "Total parcelles",
      value: formatNumber(totalParcels),
      description: "Portefeuille global",
      action: "Voir toutes les parcelles",
      href: "/parcelles",
      tone: "blue",
    },
    {
      icon: FileCheck2,
      label: "En vérification chargées",
      value: formatNumber(verificationCount),
      description: "Sur les éléments chargés",
      action: "Voir les parcelles en vérification",
      href: "/parcelles?status=to_verify",
      tone: "purple",
    },
    {
      icon: CheckCircle2,
      label: "Validées chargées",
      value: formatNumber(validCount),
      description: "Sur les éléments chargés",
      action: "Voir les parcelles validées",
      href: "/parcelles?status=completed",
      tone: "green",
    },
    {
      icon: AlertTriangle,
      label: "Bloquées chargées",
      value: formatNumber(blockedCount),
      description: "Sur les éléments chargés",
      action: "Voir les parcelles bloquées",
      href: "/parcelles?status=disputed",
      tone: "amber",
    },
  ];

  const updateFilters = (nextValues) => {
    const nextParams = new URLSearchParams();
    const normalizedValues = buildParcelQueryParams(nextValues);

    if (normalizedValues.q) nextParams.set("q", normalizedValues.q);
    if (normalizedValues.organization_code) nextParams.set("organization_code", normalizedValues.organization_code);
    if (normalizedValues.owner_client_code) nextParams.set("owner_client_code", normalizedValues.owner_client_code);
    if (normalizedValues.commune) nextParams.set("commune", normalizedValues.commune);
    if (normalizedValues.status) nextParams.set("status", normalizedValues.status);

    setSearchParams(nextParams, { replace: true });
  };

  const resetFilters = () => {
    setSearchParams({}, { replace: true });
  };

  const selectParcelAlert = (filter = {}) => {
    updateFilters({ ...queryState, ...filter });
  };

  return (
    <DashboardLayout
      title={isClientPortal ? "Mes parcelles" : "Parcelles"}
      subtitle={
        isClientPortal
          ? "Consultez vos parcelles et leur avancement."
          : "Gérez, filtrez et suivez l’ensemble des parcelles du portefeuille."
      }
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Parcelles
            </nav>

            <p className="mt-2 max-w-2xl text-sm text-mapgeo-secondary/70 lg:hidden">
              Gérez, filtrez et suivez l’ensemble des parcelles du portefeuille.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {canManageParcels ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate(buildCartoHref(queryState, returnTo), { state: { returnTo, openCreate: true } })}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
                >
                  <Pencil size={18} /> Nouvelle parcelle
                </button>

                {canImportParcels ? (
                  <a
                    href="#import-csv"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
                  >
                    <Upload size={18} /> Importer CSV
                  </a>
                ) : null}
              </>
            ) : null}

            <Link
              to={buildCartoHref(queryState, returnTo)}
              state={{ returnTo }}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
            >
              <Layers3 size={18} /> Vue cartographique
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
          {kpis.map((item) => (
            <KpiCard key={item.label} {...item} />
          ))}
        </section>

        <FilterBar
          values={queryState}
          clients={clients}
          onChange={updateFilters}
          onReset={resetFilters}
          showClientFilter={isInternalPortal}
        />

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <ParcelTable
              rows={rows}
              loading={loadingList}
              error={error}
              showClientColumn={isInternalPortal}
              returnTo={returnTo}
            />
          </div>

          <div className="space-y-6">
            <ParcelSummary
              total={totalParcels}
              rows={rows}
              onSelectAlert={selectParcelAlert}
              isInternalPortal={isInternalPortal}
            />

            {canImportParcels ? (
              <div id="import-csv">
                <CsvImportPanel
                  owners={owners}
                  canManageParcels={canImportParcels}
                  onImported={() => loadParcels(queryState)}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}