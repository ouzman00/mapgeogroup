import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Map as MapIcon,
  MapPin,
  Plus,
  RotateCcw,
  Upload,
  UserRound,
  UsersRound,
  MessageCircle,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import dashboardService from "../services/dashboardService";
import parcelService from "../services/parcelService";
import { fetchAllClients } from "../services/clientService";
import { getErrorMessage } from "../services/responseUtils";
import { PARCEL_STATUS_OPTIONS, getParcelStatusClasses, getParcelStatusLabel, normalizeParcelStatus, progressFromStatus } from "../constants/parcelConstants";
import { premium } from "../components/ui/designSystem";
import { canManageBackoffice, getRoleLabel } from "../constants/roleConstants";
import { formatDateLabel } from "../utils/dateUtils";

const FALLBACK_STATS = {
  total_parcels: 0,
  active_parcels: 0,
  completed_parcels: 0,
  total_documents: 0,
  unread_notifications: 0,
  open_support_tickets: 0,
  active_clients: 0,
};

const EMPTY_DASHBOARD_FILTERS = {
  organization_code: "",
  status: "",
  commune: "",
  period: "",
  progress: "",
};

function uniqueOptions(items, getValue, getLabel = getValue) {
  const options = new Map();

  (items || []).forEach((item) => {
    const value = String(getValue(item) || "").trim();
    const label = String(getLabel(item) || value).trim();
    if (value && !options.has(value)) {
      options.set(value, label);
    }
  });

  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
}

function normalizeClientFilterPart(value) {
  return String(value || "").trim();
}

function buildClientFilterValue(parcel) {
  const ownerClientCode = normalizeClientFilterPart(parcel?.owner_client_code);
  if (ownerClientCode) return ownerClientCode;

  const organizationCode = normalizeClientFilterPart(parcel?.organization_code);
  if (organizationCode) return organizationCode;

  const clientName = normalizeClientFilterPart(parcel?.organization_name || parcel?.owner_name);
  return clientName || "";
}

function parcelClientFilterValue(parcel) {
  return buildClientFilterValue(parcel);
}

function parcelClientFilterLabel(parcel) {
  const name = normalizeClientFilterPart(parcel?.organization_name || parcel?.owner_name);
  const code = normalizeClientFilterPart(parcel?.organization_code || parcel?.owner_client_code);

  if (name && code) return `${name} · ${code}`;
  return name || code || "Client";
}

function buildClientDirectoryOptionValue(client) {
  return normalizeClientFilterPart(
    client?.code || client?.primary_user_client_code || client?.client_code,
  );
}

function buildClientDirectoryOptionLabel(client) {
  const name = normalizeClientFilterPart(client?.name || client?.company_name);
  const code = normalizeClientFilterPart(client?.code || client?.primary_user_client_code || client?.client_code);

  if (name && code) return `${name} · ${code}`;
  return name || code || `Client ${client?.id || ""}`.trim();
}

function parcelMatchesClientFilter(parcel, filterValue) {
  const value = normalizeClientFilterPart(filterValue).toLowerCase();
  if (!value) return true;

  const exactCandidates = [
    parcel?.owner_client_code,
    parcel?.organization_code,
    parcel?.owner_id,
    parcel?.organization_id,
  ]
    .map((item) => normalizeClientFilterPart(item).toLowerCase())
    .filter(Boolean);

  if (exactCandidates.includes(value)) return true;

  const textCandidates = [
    parcel?.organization_name,
    parcel?.owner_name,
    parcel?.owner_email,
    parcel?.owner_username,
  ]
    .map((item) => normalizeClientFilterPart(item).toLowerCase())
    .filter(Boolean);

  return textCandidates.some((candidate) => candidate.includes(value) || value.includes(candidate));
}

function parcelDateMatchesPeriod(parcel, period) {
  if (!period) return true;

  const sourceDate = parcel?.updated_at || parcel?.created_at || parcel?.planned_date || parcel?.planned_at;
  if (!sourceDate) return false;

  const date = new Date(sourceDate);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const start = new Date(now);

  if (period === "today") {
    return date.toDateString() === now.toDateString();
  }

  if (period === "week") {
    start.setDate(now.getDate() - 7);
  } else if (period === "current") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (period === "month") {
    start.setMonth(now.getMonth() - 1);
  } else if (period === "quarter") {
    start.setMonth(now.getMonth() - 3);
  } else {
    return true;
  }

  return date >= start;
}

function progressMatchesBucket(value, bucket) {
  if (!bucket) return true;

  const progress = Number(value || 0);
  if (bucket === "0-25") return progress < 25;
  if (bucket === "25-50") return progress >= 25 && progress < 50;
  if (bucket === "50-75") return progress >= 50 && progress < 75;
  if (bucket === "75-100") return progress >= 75 && progress < 100;
  if (bucket === "100") return progress >= 100;
  return true;
}


function buildDashboardMapUrl(filters = {}, returnTo = "") {
  const params = new URLSearchParams();

  if (filters.organization_code) params.set("organization_code", filters.organization_code);
  if (filters.owner_client_code) params.set("owner_client_code", filters.owner_client_code);
  if (filters.status) params.set("status", filters.status);
  if (filters.commune) params.set("commune", filters.commune);
  if (filters.period) params.set("period", filters.period);
  if (returnTo) params.set("returnTo", returnTo);

  const query = params.toString();
  return query ? `/parcelles/carto?${query}` : "/parcelles/carto";
}

function buildParcelMapUrl(parcel, filters = {}, returnTo = "") {
  if (!parcel?.id) return buildDashboardMapUrl(filters, returnTo);
  const params = new URLSearchParams();
  if (filters.organization_code) params.set("organization_code", filters.organization_code);
  if (filters.owner_client_code) params.set("owner_client_code", filters.owner_client_code);
  if (filters.status) params.set("status", filters.status);
  if (filters.commune) params.set("commune", filters.commune);
  if (filters.period) params.set("period", filters.period);
  if (returnTo) params.set("returnTo", returnTo);
  const query = params.toString();
  return `/parcelles/${parcel.id}/carto${query ? `?${query}` : ""}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function averageProgress(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const total = items.reduce((sum, item) => sum + Number(item.progress || 0), 0);
  return Math.round(total / items.length);
}

function statusClasses(status) {
  return getParcelStatusClasses(status);
}


function progressClasses(value) {
  if (value >= 95) return "bg-mapgeo-primary";
  if (value >= 60) return "bg-mapgeo-primary/90";
  if (value >= 40) return "bg-mapgeo-sand";
  return "bg-mapgeo-sand/70";
}

function KpiCard({ icon: Icon, label, value, description, action, href, state, tone = "blue" }) {
  const tones = {
    blue: "bg-mapgeo-sand/15 text-mapgeo-primary",
    green: "bg-mapgeo-primary/6 text-mapgeo-primary",
    purple: "bg-mapgeo-primary/6 text-mapgeo-primary",
    amber: "bg-mapgeo-sand/15 text-mapgeo-primary",
  };

  return (
    <article className={`${premium.card} group p-6 transition hover:border-mapgeo-sand/50 sm:p-7`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-mapgeo-sand/30 ${tones[tone] || tones.blue}`}>
          <Icon size={26} strokeWidth={1.9} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-secondary/70">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-mapgeo-primary">{value}</p>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">{description}</p>
        </div>
      </div>

      <div className="mt-5 border-t border-mapgeo-line pt-4">
        <Link to={href || "/parcelles"} state={state} className="inline-flex items-center gap-2 text-sm font-bold text-mapgeo-primary transition group-hover:gap-3">
          {action} <ChevronRight size={16} />
        </Link>
      </div>
    </article>
  );
}

function DashboardFilterSelect({ label, icon: Icon, value, onChange, children }) {
  return (
    <label className="min-w-0 space-y-1.5">
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>
      <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm transition focus-within:border-mapgeo-primary/40 focus-within:ring-4 focus-within:ring-mapgeo-primary/5">
        {Icon ? <Icon size={16} className="shrink-0 text-mapgeo-secondary/60" /> : null}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold outline-none focus:shadow-none"
        >
          {children}
        </select>
      </div>
    </label>
  );
}

function FilterBar({
  isInternalPortal,
  filters,
  setFilters,
  onReset,
  clientOptions = [],
  communeOptions = [],
}) {
  const update = (name, value) => setFilters((current) => ({ ...current, [name]: value }));

  return (
    <section className={`${premium.card} p-5`}>
      <div
        className={
          isInternalPortal
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1.1fr_1.1fr_1.2fr_1.1fr_1.25fr_1fr_auto]"
            : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_1.25fr_1fr_auto]"
        }
      >
        {isInternalPortal ? (
          <DashboardFilterSelect label="Client" icon={UserRound} value={filters.organization_code} onChange={(value) => update("organization_code", value)}>
            <option value="">Tous les clients</option>
            {clientOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </DashboardFilterSelect>
        ) : null}

        <DashboardFilterSelect label="Statut dossier" icon={CheckCircle2} value={filters.status} onChange={(value) => update("status", value)}>
          <option value="">Tous les statuts</option>
          {PARCEL_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </DashboardFilterSelect>

        <DashboardFilterSelect label="Commune / zone" icon={MapPin} value={filters.commune} onChange={(value) => update("commune", value)}>
          <option value="">Toutes les communes</option>
          {communeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </DashboardFilterSelect>

        <DashboardFilterSelect label="Période" icon={CalendarDays} value={filters.period} onChange={(value) => update("period", value)}>
          <option value="">Toutes les périodes</option>
          <option value="today">Aujourd’hui</option>
          <option value="week">7 derniers jours</option>
          <option value="current">Période en cours</option>
          <option value="month">30 derniers jours</option>
          <option value="quarter">3 derniers mois</option>
        </DashboardFilterSelect>

        <DashboardFilterSelect label="Avancement" icon={BarChart3} value={filters.progress} onChange={(value) => update("progress", value)}>
          <option value="">Tous</option>
          <option value="0-25">Moins de 25%</option>
          <option value="25-50">25% à 49%</option>
          <option value="50-75">50% à 74%</option>
          <option value="75-100">75% à 99%</option>
          <option value="100">100%</option>
        </DashboardFilterSelect>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 text-sm font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory xl:w-auto"
          >
            <RotateCcw size={16} /> Réinitialiser
          </button>
        </div>
      </div>
    </section>
  );
}

function PortfolioTable({ rows, loading, error, isClientPortal, isInternalPortal, returnTo, mapHref = "/parcelles/carto", progressFilterNotice = "" }) {
  return (
    <section className={`${premium.card} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-mapgeo-line p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h3 className="text-xl font-extrabold text-mapgeo-primary">
            {isClientPortal ? "Mes parcelles récentes" : "Portefeuilles clients récents"}
          </h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            {isClientPortal
              ? "Suivez l’avancement de vos parcelles et consultez leur dossier."
              : "Suivez les 100 dernières parcelles chargées, regroupées par portefeuille client. Les KPI ci-dessus viennent des statistiques serveur complètes."}
          </p>
        </div>

        <div className="inline-flex items-center gap-2 text-xs font-medium text-mapgeo-secondary/70">
          <Clock3 size={15} /> Données synchronisées avec le backend
          <RotateCcw size={15} className="text-mapgeo-primary" />
        </div>
      </div>

      {loading ? <div className="p-6 text-sm text-mapgeo-secondary">Chargement du tableau de bord…</div> : null}

      {error ? (
        <div className="m-6 rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm font-medium text-mapgeo-primary">{error}</div>
      ) : null}

      {!loading && !error ? (
        <div className="overflow-x-auto">
          <table className="mapgeo-table min-w-[860px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
                {isInternalPortal ? <th className="px-5 py-4">Client</th> : null}
                <th className="px-4 py-4">Parcelles</th>
                <th className="px-4 py-4">Commune</th>
                {isInternalPortal ? <th className="px-4 py-4">Responsable</th> : null}
                <th className="px-4 py-4">Statut</th>
                <th className="px-4 py-4">Avancement</th>
                <th className="px-4 py-4">Dernière mise à jour</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-mapgeo-line">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={isInternalPortal ? 8 : 6} className="px-5 py-10 text-center text-mapgeo-secondary">
                    Aucune parcelle récente à afficher.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="transition hover:bg-mapgeo-ivory/50">
                    {isInternalPortal ? (
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className={`flex h-9 w-9 items-center justify-center rounded-full ${row.accent} text-sm font-extrabold text-white shadow-sm`}>
                            {row.client?.[0] || "C"}
                          </span>
                          <span className="font-extrabold text-mapgeo-primary">{row.client}</span>
                        </div>
                      </td>
                    ) : null}

                    <td className="px-4 py-4 font-semibold text-mapgeo-primary">{row.parcels}</td>
                    <td className="px-4 py-4 text-mapgeo-secondary">{row.commune}</td>

                    {isInternalPortal ? <td className="px-4 py-4 text-mapgeo-secondary">{row.manager}</td> : null}

                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${statusClasses(row.status)}`}>
                        {row.status}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span className="w-10 text-xs font-bold text-mapgeo-primary">{row.progress}%</span>
                        <span className="h-2 w-24 overflow-hidden rounded-full bg-mapgeo-ivory">
                          <span className={`block h-full rounded-full ${progressClasses(row.progress)}`} style={{ width: `${Math.min(row.progress, 100)}%` }} />
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-4 text-mapgeo-secondary">{row.updatedAt}</td>

                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={row.href || "/parcelles"}
                          state={{ returnTo }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:border-mapgeo-primary/20 hover:bg-mapgeo-ivory"
                        >
                          {row.action}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="flex justify-center border-t border-mapgeo-line px-6 py-5">
          <div className="flex flex-col items-center gap-2 text-center">
            {progressFilterNotice ? <p className="text-xs font-semibold text-mapgeo-secondary/70">{progressFilterNotice}</p> : null}
            <Link to={isClientPortal ? "/parcelles" : mapHref} state={{ returnTo }} className="inline-flex items-center gap-2 text-sm font-extrabold text-mapgeo-primary transition hover:gap-3">
              {isClientPortal ? "Voir mes parcelles" : "Voir la carte avec les filtres"} <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OperationalSummary({ stats, user, isClientPortal }) {
  const clientActions = [
    { label: "Voir mes parcelles", icon: MapIcon, color: "text-mapgeo-sand", href: "/parcelles" },
    { label: "Consulter mes documents", icon: FileText, color: "text-mapgeo-sand", href: "/documents" },
    { label: "Mes demandes support", icon: MessageCircle, color: "text-mapgeo-sand", href: "/support" },
    { label: "Mes notifications", icon: BellRing, color: "text-mapgeo-sand", href: "/notifications" },
  ];

  const internalAlerts = [
    { label: `${formatNumber(stats.disputed_parcels || 0)} dossier(s) bloqué(s)`, icon: AlertTriangle, color: "text-mapgeo-sand", href: "/parcelles?status=disputed" },
    { label: `${formatNumber(stats.to_verify_parcels || 0)} vérification(s) en attente`, icon: Clock3, color: "text-mapgeo-sand", href: "/parcelles?status=to_verify" },
    { label: `${formatNumber(stats.unread_notifications || 0)} notification(s) non lue(s)`, icon: BellRing, color: "text-mapgeo-sand", href: "/notifications" },
  ];

  const actions = isClientPortal ? clientActions : internalAlerts;

  return (
    <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel sm:p-7">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl" />

      <div className="relative">
        <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">
          {isClientPortal ? "Résumé de mon espace" : "Résumé opérationnel"}
        </h3>

        <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
          {!isClientPortal ? (
            <SummaryMetric icon={UsersRound} label="Clients actifs" value={formatNumber(stats.active_clients)} />
          ) : null}

          <SummaryMetric icon={MapIcon} label={isClientPortal ? "Mes parcelles" : "Parcelles suivies"} value={formatNumber(stats.total_parcels)} />
          <SummaryMetric icon={FileText} label="Documents" value={formatNumber(stats.total_documents)} />
          <SummaryMetric icon={MessageCircle} label={isClientPortal ? "Mes demandes support" : "Tickets ouverts"} value={formatNumber(stats.open_support_tickets)} />
          <SummaryMetric icon={Clock3} label="Dernier accès" value={user?.username || "Utilisateur"} />
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/75">
            {isClientPortal ? "Accès rapides" : "Alertes à traiter"}
          </h4>

          <div className="mt-3 space-y-3">
            {actions.map((item) => {
              const Icon = item.icon;

              return (
                <Link key={item.label} to={item.href} className="flex w-full items-center gap-3 rounded-2xl py-1.5 text-left text-sm font-semibold text-white/90 transition hover:bg-white/5">
                  <Icon size={17} className={item.color} />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight size={16} className="text-white/60" />
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Portail</p>
            <p className="mt-1 font-extrabold">{isClientPortal ? "Client" : "Interne"}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Rôle</p>
            <p className="mt-1 font-extrabold">{isClientPortal ? "Client" : getRoleLabel(user?.role)}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SummaryMetric({ icon: Icon, label, value, danger = false }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={17} className={danger ? "text-mapgeo-sand" : "text-white/70"} />
      <span className="flex-1 text-white/80">{label}</span>
      <span className={`font-extrabold ${danger ? "text-mapgeo-sand" : "text-white"}`}>{value}</span>
    </div>
  );
}

function ExecutiveHero({ title, subtitle, stats, isClientPortal, canManageParcels, dashboardReturnTo = "/dashboard", mapHref = "/parcelles/carto", navigate }) {
  return (
    <section className="mapgeo-card overflow-hidden rounded-3xl border border-mapgeo-line bg-white/95 p-6 shadow-soft lg:p-8">
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
        <div>
          <p className={premium.eyebrow}>
            {isClientPortal ? "Espace client sécurisé" : "Pilotage foncier consolidé"}
          </p>

          <h1 className="mt-3 max-w-4xl text-3xl font-extrabold tracking-[-0.045em] text-mapgeo-primary sm:text-4xl xl:text-5xl">
            {title}
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-7 text-mapgeo-secondary/72">
            {subtitle}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {isClientPortal ? (
              <>
                <Link
                  to="/support"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
                >
                  <Plus size={18} /> Nouvelle demande
                </Link>

                <Link
                  to="/parcelles"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
                >
                  <MapIcon size={18} /> Voir mes parcelles
                </Link>
              </>
            ) : canManageParcels ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate(mapHref, { state: { returnTo: dashboardReturnTo, openCreate: true } })}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
                >
                  <Plus size={18} /> Nouvelle parcelle
                </button>

                <Link
                  to="/parcelles#import-csv"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
                >
                  <Upload size={18} /> Importer CSV
                </Link>
              </>
            ) : (
              <Link
                to={mapHref}
                state={{ returnTo: dashboardReturnTo }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
              >
                <MapIcon size={18} /> Voir la cartographie
              </Link>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-mapgeo-sand/30 bg-mapgeo-ivory/65 p-5">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mapgeo-secondary/60">
            {isClientPortal ? "Synthèse de mon espace" : "Synthèse prioritaire"}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <HeroMetric label={isClientPortal ? "Mes parcelles" : "Parcelles"} value={formatNumber(stats.total_parcels)} />
            <HeroMetric label={isClientPortal ? "Dossiers actifs" : "Dossiers actifs"} value={formatNumber(stats.active_parcels)} />
            <HeroMetric label="Documents" value={formatNumber(stats.total_documents)} />
            <HeroMetric label={isClientPortal ? "Notifications" : "Alertes"} value={formatNumber(stats.unread_notifications)} attention />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMetric({ label, value, attention = false }) {
  return (
    <div className="rounded-2xl border border-mapgeo-line bg-white/80 p-4">
      <p className="text-[0.66rem] font-extrabold uppercase tracking-[0.14em] text-mapgeo-secondary/55">{label}</p>
      <p className={`mt-2 text-2xl font-extrabold tracking-tight ${attention ? "text-mapgeo-sand" : "text-mapgeo-primary"}`}>
        {value}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const dashboardReturnTo = `${location.pathname}${location.search || ""}`;
  const { user, isClientPortal, isInternalPortal } = useAuth();
  const canManageParcels = canManageBackoffice(user, isInternalPortal);
  const [stats, setStats] = useState(null);
  const [recentParcels, setRecentParcels] = useState([]);
  const [clientDirectory, setClientDirectory] = useState([]);
  const [filters, setFilters] = useState(EMPTY_DASHBOARD_FILTERS);
  const [loading, setLoading] = useState(true);
  const [parcelsLoading, setParcelsLoading] = useState(false);
  const [parcelsError, setParcelsError] = useState("");
  const [error, setError] = useState("");

  // Chargement initial : stats + annuaire clients (pas les parcelles)
  useEffect(() => {
    const loadDashboard = async () => {
      setLoading(true);
      setError("");

      try {
        const [statsPayload, clientsPayload] = await Promise.all([
          dashboardService.getStats(),
          isInternalPortal
            ? fetchAllClients({ ordering: "name" }).catch(() => ({ results: [] }))
            : Promise.resolve({ results: [] }),
        ]);

        setStats(statsPayload);
        setClientDirectory(clientsPayload.results || []);
      } catch (loadError) {
        console.error(loadError);
        setError(getErrorMessage(loadError, "Impossible de charger le tableau de bord."));
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, [isInternalPortal]);

  // Rechargement des parcelles à chaque changement de filtre (requête backend)
  useEffect(() => {
    const loadParcels = async () => {
      setParcelsLoading(true);
      setParcelsError("");
      try {
        const params = { page_size: 100 };
        if (filters.organization_code) params.organization_code = filters.organization_code;
        if (filters.status) params.status = filters.status;
        if (filters.commune) params.commune = filters.commune;
        if (filters.period) params.period = filters.period;
        const parcelPayload = await parcelService.getParcels(params);
        setRecentParcels(parcelPayload.results || []);
      } catch (e) {
        console.error(e);
        setParcelsError("Impossible de charger les parcelles. Vérifiez votre connexion.");
      } finally {
        setParcelsLoading(false);
      }
    };
    loadParcels();
  }, [filters.organization_code, filters.status, filters.commune, filters.period]);

  const resolvedStats = useMemo(() => ({ ...FALLBACK_STATS, ...(stats || {}) }), [stats]);

  // Le filtre "progress" reste côté client (calculé côté UI, pas en base)
  const filteredRecentParcels = useMemo(() => {
    if (!filters.progress) return recentParcels;
    return recentParcels.filter((parcel) => {
      const progress = Number(parcel.progress ?? progressFromStatus(parcel.status) ?? 0);
      return progressMatchesBucket(progress, filters.progress);
    });
  }, [filters.progress, recentParcels]);

  const filterOptions = useMemo(() => ({
    clients: clientDirectory.length
      ? uniqueOptions(clientDirectory, buildClientDirectoryOptionValue, buildClientDirectoryOptionLabel)
      : uniqueOptions(recentParcels, parcelClientFilterValue, parcelClientFilterLabel),
    communes: uniqueOptions(recentParcels, (parcel) => parcel.commune || parcel.location),
  }), [clientDirectory, recentParcels]);

  const dashboardMapUrl = useMemo(() => buildDashboardMapUrl(filters, dashboardReturnTo), [dashboardReturnTo, filters]);
  const progressFilterNotice = filters.progress
    ? "Le filtre avancement est appliqué au tableau affiché. Il n'est pas transmis à la carte car l'avancement est calculé côté interface."
    : "";

  const kpis = useMemo(() => {
    if (isClientPortal) {
      return [
        {
          icon: MapIcon,
          label: "Mes parcelles",
          value: formatNumber(resolvedStats.total_parcels),
          description: "Parcelles rattachées à votre compte",
          action: "Voir mes parcelles",
          href: "/parcelles",
          tone: "blue",
        },
        {
          icon: FileText,
          label: "Mes documents",
          value: formatNumber(resolvedStats.total_documents),
          description: "Documents disponibles",
          action: "Accéder aux documents",
          href: "/documents",
          tone: "purple",
        },
        {
          icon: MessageCircle,
          label: "Mes demandes support",
          value: formatNumber(resolvedStats.open_support_tickets),
          description: "Demandes en cours ou ouvertes",
          action: "Voir mes demandes",
          href: "/support",
          tone: "green",
        },
        {
          icon: BellRing,
          label: "Notifications",
          value: formatNumber(resolvedStats.unread_notifications),
          description: "Messages et alertes de suivi",
          action: "Voir mes notifications",
          href: "/notifications",
          tone: "amber",
        },
      ];
    }

    return [
      {
        icon: UsersRound,
        label: "Clients actifs",
        value: formatNumber(resolvedStats.active_clients),
        description: canManageParcels ? "Comptes opérationnels · portefeuille complet" : "Comptes dans votre périmètre",
        action: canManageParcels ? "Voir les clients" : "Voir la cartographie",
        href: canManageParcels ? "/clients" : dashboardMapUrl,
        tone: "blue",
      },
      {
        icon: MapIcon,
        label: "Parcelles suivies",
        value: formatNumber(resolvedStats.total_parcels),
        description: "Portefeuille global · KPI serveur complet",
        action: "Voir la carte filtrée",
        href: dashboardMapUrl,
        state: { returnTo: dashboardReturnTo },
        tone: "green",
      },
      {
        icon: FileText,
        label: "Documents disponibles",
        value: formatNumber(resolvedStats.total_documents),
        description: "Livrables reliés aux parcelles · portefeuille complet",
        action: "Accéder aux documents",
        href: "/documents",
        tone: "purple",
      },
      {
        icon: AlertTriangle,
        label: "Alertes à traiter",
        value: formatNumber(resolvedStats.unread_notifications),
        description: "Points nécessitant une action · portefeuille complet",
        action: "Voir les alertes",
        href: "/notifications",
        tone: "amber",
      },
    ];
  }, [canManageParcels, dashboardMapUrl, dashboardReturnTo, isClientPortal, resolvedStats]);

  const portfolioRows = useMemo(() => {
    if (!filteredRecentParcels.length) return [];

    if (isClientPortal) {
      return filteredRecentParcels.map((parcel, index) => ({
        id: parcel.id || `parcel-${index}`,
        client: parcel.owner_client_code || parcel.owner_name || "Client",
        parcels: parcel.reference || parcel.title_number || `Parcelle ${index + 1}`,
        commune: parcel.commune || parcel.location || "—",
        manager: "—",
        status: getParcelStatusLabel(parcel.status),
        progress: Number(parcel.progress ?? progressFromStatus(parcel.status) ?? 0),
        updatedAt: formatDateLabel(parcel.updated_at),
        href: buildParcelMapUrl(parcel, filters, dashboardReturnTo),
        action: "Ouvrir la carte",
        accent: "bg-mapgeo-primary",
      }));
    }

    const groups = new Map();

    filteredRecentParcels.forEach((parcel) => {
      const clientFilterValue = buildClientFilterValue(parcel);
      const ownerClientCode = parcel.owner_client_code || parcel.organization_code || "";
      const key = clientFilterValue || parcel.owner_name || parcel.organization_name || `parcel-${parcel.id}`;

      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          ownerClientCode,
          client: parcel.organization_name || parcel.owner_name || parcel.owner_client_code || "Client",
          parcels: 0,
          commune: parcel.commune || parcel.location || "—",
          manager: "Équipe MAPGEO",
          status: getParcelStatusLabel(parcel.status),
          progressValues: [],
          updatedAt: formatDateLabel(parcel.updated_at),
          href: buildParcelMapUrl(parcel, {
              ...filters,
              organization_code: parcel.organization_code || filters.organization_code || "",
              owner_client_code: parcel.owner_client_code || filters.owner_client_code || "",
            }, dashboardReturnTo),
          action: "Voir la carte",
          accent: "bg-mapgeo-primary",
        });
      }

      const group = groups.get(key);
      group.parcels += 1;
      group.progressValues.push(Number(parcel.progress ?? progressFromStatus(parcel.status) ?? 0));
      group.progress = averageProgress(group.progressValues.map((progress) => ({ progress })));
    });

    return Array.from(groups.values()).map((group) => ({
      ...group,
      progress: group.progress || 0,
      accent: "bg-mapgeo-primary",
    }));
  }, [dashboardReturnTo, filteredRecentParcels, filters, isClientPortal]);

  const title = isClientPortal ? "Mon espace client" : "Pilotage cartographique";

  const subtitle = isClientPortal
    ? "Retrouvez vos parcelles, vos documents et vos demandes support."
    : "Supervisez les clients, les dossiers et les parcelles avec une lecture métier claire.";

  return (
    <DashboardLayout title={title} subtitle={subtitle}>
      <div className="space-y-6">
        <ExecutiveHero
          title={title}
          subtitle={subtitle}
          stats={resolvedStats}
          isClientPortal={isClientPortal}
          canManageParcels={canManageParcels}
          dashboardReturnTo={dashboardReturnTo}
          mapHref={dashboardMapUrl}
          navigate={navigate}
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {kpis.map((item) => (
            <KpiCard key={item.label} {...item} />
          ))}
        </section>

        <FilterBar
          isInternalPortal={isInternalPortal}
          filters={filters}
          setFilters={setFilters}
          onReset={() => setFilters(EMPTY_DASHBOARD_FILTERS)}
          clientOptions={filterOptions.clients}
          communeOptions={filterOptions.communes}
        />

        <div className="rounded-2xl border border-mapgeo-line bg-white/75 px-4 py-3 text-sm font-medium text-mapgeo-secondary/75 shadow-sm">
          KPI : statistiques serveur complètes sur tout le portefeuille. Tableau : 100 dernières parcelles chargées avec les filtres actifs. Le filtre client affiche tous les clients disponibles, même ceux sans parcelle récente.
          {progressFilterNotice ? ` ${progressFilterNotice}` : ""}
        </div>

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <PortfolioTable
            rows={portfolioRows}
            loading={loading || parcelsLoading}
            error={error || parcelsError}
            isClientPortal={isClientPortal}
            isInternalPortal={isInternalPortal}
            returnTo={dashboardReturnTo}
            mapHref={dashboardMapUrl}
            progressFilterNotice={progressFilterNotice}
          />

          <OperationalSummary stats={resolvedStats} user={user} isClientPortal={isClientPortal} />
        </section>
      </div>
    </DashboardLayout>
  );
}
