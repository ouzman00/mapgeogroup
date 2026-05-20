import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  KeyRound,
  Mail,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import { activateUser, createClient, deactivateUser, deleteClient, fetchAllClients, resetClientAccess, updateClient } from "../services/clientService";
import { getErrorMessage } from "../services/responseUtils";
import {
  getPortalAccessActionLabel,
  getPortalAccessClasses,
  getPortalAccessLabel,
  normalizePortalAccessStatus,
} from "../constants/clientConstants";
import { formatDateLabel } from "../utils/dateUtils";
import PasswordInput from "../components/ui/PasswordInput";
import { LoadingTableRow } from "../components/ui/LoadingState";

const emptyForm = {
  name: "",
  code: "",
  identity_number: "",
  metadata: {},
  status: "active",
  email: "",
  phone: "",
  address: "",
  username: "",
  first_name: "",
  last_name: "",
  password: "",
  type: "entreprise",
  portalAccess: true,
  sendInvitation: true,
};

const emptyFilters = {
  q: "",
  status: "",
  commune: "",
  parcelRange: "",
  activity: "",
};

const statusLabels = {
  active: "Actif",
  prospect: "Prospect",
  inactive: "Inactif",
  archived: "Archivé",
};

function payloadFrom(form, editing = false) {
  const identityNumber = String(form.identity_number || "").trim();
  const metadata = {
    ...(form.metadata || {}),
    type: form.type || "entreprise",
  };

  if (identityNumber) metadata.identity_number = identityNumber;
  else delete metadata.identity_number;

  const basePayload = {
    name: form.name.trim(),
    code: form.code.trim().toUpperCase(),
    status: form.status,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    address: form.address.trim() || null,
    organization_type: "client",
    identity_number: identityNumber || null,
    metadata,
  };

  if (editing) {
    return basePayload;
  }

  const contactParts = form.first_name.trim().split(/\s+/).filter(Boolean);

  return {
    ...basePayload,
    portal_access: Boolean(form.portalAccess),
    send_invitation: Boolean(form.portalAccess && form.sendInvitation),
    username: form.username.trim() || undefined,
    first_name: contactParts.shift() || "",
    last_name: contactParts.join(" "),
    company_name: form.name.trim(),
    password: form.portalAccess && !form.sendInvitation ? form.password.trim() || undefined : undefined,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function clientInitial(client) {
  return String(client?.name || client?.code || "C").charAt(0).toUpperCase();
}

function portalAccessLabel(client) {
  return getPortalAccessLabel(client);
}

function shouldDisableClient(client) {
  return String(client?.status || "").toLowerCase() === "inactive" || String(client?.status || "").toLowerCase() === "archived";
}

function accessActionLabel(client) {
  return getPortalAccessActionLabel(client);
}
function isPortalAccessEnabled(client) {
  return normalizePortalAccessStatus(client) === "active";
}

function clientLocationText(client) {
  const metadata = client?.metadata || {};
  return [
    client?.address,
    metadata.commune,
    metadata.city,
    metadata.region,
    metadata.department,
    metadata.zone,
  ]
    .filter(Boolean)
    .join(" ");
}

function parseClientDate(client) {
  const raw = client?.updated_at || client?.created_at || client?.last_activity_at;
  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesActivityPeriod(client, period) {
  if (!period) return true;

  const date = parseClientDate(client);
  if (!date) return false;

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "today") {
    return date >= start;
  }

  if (period === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return date >= start;
  }

  if (period === "month") {
    start.setDate(1);
    return date >= start;
  }

  return true;
}


function normalizeClient(client, index = 0) {
  const contactName =
    client.contact_name ||
    [client.first_name, client.last_name].filter(Boolean).join(" ") ||
    client.contact_full_name ||
    client.name ||
    "Contact à renseigner";

  return {
    ...client,
    code: client.code || client.client_code || `CL-${String(index + 1).padStart(3, "0")}`,
    contact_name: contactName,
    parcels_count: Number(client.parcels_count ?? client.parcel_count ?? client.parcels?.length ?? 0),
    last_activity:
      client.last_activity ||
      client.updated_at_label ||
      formatDateLabel(client.updated_at || client.created_at || client.last_activity_at, "—"),
    portal_access: portalAccessLabel(client),
    accent:
      client.accent ||
      ["bg-mapgeo-primary", "bg-mapgeo-primary", "bg-mapgeo-primary", "bg-mapgeo-sand", "bg-mapgeo-primary/70", "bg-mapgeo-primary"][index % 6],
  };
}

function statusClasses(status) {
  const value = String(status || "").toLowerCase();

  if (value === "active" || value.includes("actif")) return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (value === "prospect") return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  if (value === "inactive" || value.includes("inactif")) return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (value === "archived" || value.includes("archiv")) return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/75";

  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary";
}

function accessClasses(client) {
  return getPortalAccessClasses(client);
}

function KpiCard({ icon: Icon, label, value, description, action, onClick, tone = "blue" }) {
  const tones = {
    blue: "bg-mapgeo-sand/15 text-mapgeo-primary",
    purple: "bg-mapgeo-sand/15 text-mapgeo-primary",
    green: "bg-mapgeo-primary/6 text-mapgeo-primary",
    orange: "bg-mapgeo-sand/10 text-mapgeo-primary",
  };

  return (
    <article className="group rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft transition hover:border-mapgeo-sand/50">
      <div className="flex items-start gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tones[tone] || tones.blue}`}>
          <Icon size={27} strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-mapgeo-secondary/70">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-mapgeo-primary">{value}</p>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">{description}</p>
        </div>
      </div>

      <div className="mt-5 border-t border-mapgeo-line pt-4">
        <button type="button" onClick={onClick} className="inline-flex items-center gap-2 text-sm font-bold text-mapgeo-primary transition group-hover:gap-3">
          {action} <ChevronRight size={16} />
        </button>
      </div>
    </article>
  );
}

function FilterBar({ filters, onChange, onReset }) {
  const update = (name, value) => onChange({ ...filters, [name]: value });

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-4 shadow-soft">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr_1fr_1.1fr_auto]">
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-mapgeo-primary/80">Recherche</span>
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm focus-within:border-mapgeo-primary/40 focus-within:ring-4 focus-within:ring-mapgeo-primary/5">
            <Search size={16} className="text-mapgeo-secondary/60" />
            <input
              value={filters.q}
              onChange={(event) => update("q", event.target.value)}
              placeholder="Rechercher un client..."
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
            />
          </div>
        </label>

        <SelectField label="Statut" icon={ShieldCheck} value={filters.status} onChange={(value) => update("status", value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>

        <InputField
          label="Commune"
          icon={CalendarDays}
          value={filters.commune}
          onChange={(value) => update("commune", value)}
          placeholder="Toutes les communes"
        />

        <SelectField
          label="Nombre de parcelles"
          icon={BriefcaseBusiness}
          value={filters.parcelRange}
          onChange={(value) => update("parcelRange", value)}
        >
          <option value="">Toutes</option>
          <option value="none">Sans parcelle</option>
          <option value="has">Avec parcelles</option>
          <option value="1-10">1 à 10</option>
          <option value="10+">Plus de 10</option>
        </SelectField>

        <SelectField
          label="Dernière activité"
          icon={CalendarDays}
          value={filters.activity}
          onChange={(value) => update("activity", value)}
        >
          <option value="">Toutes les périodes</option>
          <option value="today">Aujourd’hui</option>
          <option value="week">Cette semaine</option>
          <option value="month">Ce mois-ci</option>
        </SelectField>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 text-sm font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory xl:w-auto"
          >
            <RefreshCcw size={16} /> Réinitialiser
          </button>
        </div>
      </div>
    </section>
  );
}

function InputField({ label, icon: Icon, value, onChange, placeholder }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>
      <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
        <Icon size={16} className="text-mapgeo-secondary/60" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
        />
      </div>
    </label>
  );
}

function SelectField({ label, icon: Icon, value, onChange, children }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>
      <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
        <Icon size={16} className="text-mapgeo-secondary/60" />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
        >
          {children}
        </select>
      </div>
    </label>
  );
}

const CLIENTS_PAGE_SIZE = 20;

function ClientsTable({ clients, loading, actionSaving, onDeleteClient, onDelete, onResetAccess }) {
  const [page, setPage] = useState(1);

  // Reset page when clients list changes (filter applied)
  useEffect(() => { setPage(1); }, [clients]);

  const totalPages = Math.max(1, Math.ceil(clients.length / CLIENTS_PAGE_SIZE));
  const pageClients = clients.slice((page - 1) * CLIENTS_PAGE_SIZE, page * CLIENTS_PAGE_SIZE);
  const start = clients.length ? (page - 1) * CLIENTS_PAGE_SIZE + 1 : 0;
  const end = Math.min(page * CLIENTS_PAGE_SIZE, clients.length);

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-mapgeo-line p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">Liste des clients</h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            Suivez les comptes clients, les accès portail et les portefeuilles associés.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-medium text-mapgeo-secondary/70">
          Données synchronisées avec le backend
          <RefreshCcw size={15} className="text-mapgeo-primary" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1080px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
              <th className="px-5 py-4">Client</th>
              <th className="px-4 py-4">Code</th>
              <th className="px-4 py-4">Contact</th>
              <th className="px-4 py-4">Parcelles</th>
              <th className="px-4 py-4">Statut</th>
              <th className="px-4 py-4">Dernière activité</th>
              <th className="px-4 py-4">Accès portail</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-mapgeo-line">
            {loading ? (
              <LoadingTableRow
                colSpan={8}
                title="Veuillez patienter"
                message="Mise à jour de la liste clients."
              />
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan="8" className="px-5 py-10 text-center text-mapgeo-secondary">
                  Aucun client trouvé.
                </td>
              </tr>
            ) : (
              pageClients.map((client) => (
                <tr key={client.id} className="transition hover:bg-mapgeo-ivory/40">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-full ${client.accent} text-sm font-extrabold text-white shadow-sm`}
                      >
                        {clientInitial(client)}
                      </span>
                      <span className="font-extrabold text-mapgeo-primary">{client.name}</span>
                    </div>
                  </td>

                  <td className="px-4 py-4 font-semibold text-mapgeo-primary">{client.code}</td>

                  <td className="px-4 py-4">
                    <span className="block font-semibold text-mapgeo-primary">{client.contact_name}</span>
                    <span className="text-xs text-mapgeo-secondary/70">{client.email || "Email non renseigné"}</span>
                  </td>

                  <td className="px-4 py-4 font-semibold text-mapgeo-primary">{formatNumber(client.parcels_count)}</td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${statusClasses(client.status)}`}>
                      {statusLabels[client.status] || client.status}
                    </span>
                  </td>

                  <td className="px-4 py-4 text-mapgeo-secondary">{client.last_activity}</td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${accessClasses(client)}`}>
                      {client.portal_access}
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/clients/${client.id}`}
                        className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory"
                      >
                        Ouvrir portefeuille
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDeleteClient(client)}
                        disabled={actionSaving}
                        className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Supprimer le client
                      </button>
                      <button
                        type="button"
                        onClick={() => onResetAccess(client)}
                        disabled={!client.primary_user_id || actionSaving}
                        className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {accessActionLabel(client)}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(client)}
                        disabled={shouldDisableClient(client) || actionSaving}
                        className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {shouldDisableClient(client) ? "Déjà inactif" : "Désactiver"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 border-t border-mapgeo-line px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-mapgeo-secondary/70">
          {clients.length
            ? `Affichage de ${start} à ${end} sur ${clients.length} client${clients.length > 1 ? "s" : ""}`
            : "Aucun client à afficher"}
        </p>
        {totalPages > 1 ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-xl border border-mapgeo-line p-2 text-mapgeo-secondary transition hover:bg-mapgeo-ivory disabled:opacity-40"
              aria-label="Page précédente"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && p - arr[idx - 1] > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === "…"
                  ? <span key={`ellipsis-${idx}`} className="px-1 text-mapgeo-secondary/50 text-sm select-none">…</span>
                  : <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      aria-current={page === p ? "page" : undefined}
                      className={`min-w-[34px] rounded-xl px-2 py-2 text-sm font-bold transition ${
                        page === p
                          ? "bg-mapgeo-primary text-white shadow-soft"
                          : "border border-mapgeo-line text-mapgeo-primary hover:bg-mapgeo-ivory"
                      }`}
                    >
                      {p}
                    </button>
              )}
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-xl border border-mapgeo-line p-2 text-mapgeo-secondary transition hover:bg-mapgeo-ivory disabled:opacity-40"
              aria-label="Page suivante"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ClientSummary({ clients, user, onSelectAlert }) {
  const active = clients.filter((client) => client.status === "active").length;
  const prospects = clients.filter((client) => client.status === "prospect").length;
  const totalParcels = clients.reduce((sum, client) => sum + Number(client.parcels_count || 0), 0);
  const openPortfolios = clients.filter((client) => Number(client.parcels_count || 0) > 0).length;
  const inactive = clients.filter((client) => client.status === "inactive").length;
  const noPortfolio = clients.filter((client) => Number(client.parcels_count || 0) === 0).length;
  const pendingInvitations = clients.filter((client) => String(client.portal_access || "").toLowerCase().includes("invitation")).length;

  const alerts = [
    { label: `${pendingInvitations} invitation(s) en attente`, color: "bg-mapgeo-sand", filter: { q: "Invitation en attente" } },
    { label: `${inactive} compte(s) inactif(s) à relancer`, color: "bg-mapgeo-sand", filter: { status: "inactive" } },
    { label: `${noPortfolio} client(s) sans portefeuille`, color: "bg-mapgeo-sand", filter: { parcelRange: "none" } },
  ];

  return (
    <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl" />
      <div className="relative">
        <h3 className="text-sm font-extrabold text-white">Résumé client</h3>

        <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
          <SummaryMetric icon={UsersRound} label="Clients actifs" value={formatNumber(active)} />
          <SummaryMetric icon={UserPlus} label="Prospects" value={formatNumber(prospects)} />
          <SummaryMetric icon={BriefcaseBusiness} label="Portefeuilles ouverts" value={formatNumber(openPortfolios)} />
          <SummaryMetric icon={Building2} label="Total parcelles" value={formatNumber(totalParcels)} />
          <SummaryMetric icon={Clock3} label="Session" value={user?.username || user?.email || "—"} />
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-sm font-extrabold text-white">Alertes</h4>
          <div className="mt-3 space-y-3">
            {alerts.map((alert) => (
              <button
                key={alert.label}
                type="button"
                onClick={() => onSelectAlert?.(alert.filter)}
                className="flex w-full items-center gap-3 rounded-2xl py-1.5 text-left text-sm font-semibold text-white/90 transition hover:bg-white/5"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${alert.color}`} />
                <span className="flex-1">{alert.label}</span>
                <ChevronRight size={16} className="text-white/60" />
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Portail</p>
            <p className="mt-1 font-extrabold">{user?.portal_type === "client" ? "Client" : "Interne"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Rôle</p>
            <p className="mt-1 font-extrabold">{user?.role || "—"}</p>
          </div>
        </div>
      </div>
    </aside>
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

function ClientFormPanel({ form, setForm, editingClient, saving, onSubmit, onCancel }) {
  const hasPrimaryUser = Boolean(editingClient?.primary_user_id);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">
            {editingClient ? "Modifier le client" : "Nouveau client"}
          </h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            Structurez les informations client, le contact principal et l’accès portail.
          </p>
        </div>
        {editingClient ? (
          <button type="button" onClick={onCancel} className="rounded-2xl p-2 text-mapgeo-secondary hover:bg-mapgeo-ivory">
            <X size={20} />
          </button>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FormSection title="1. Informations client">
            <TextInput label="Nom de l’entreprise" required value={form.name} onChange={(value) => update("name", value)} placeholder="Ex. SENAGRI" />
            <TextInput label="Code client" required value={form.code} onChange={(value) => update("code", value)} placeholder="Ex. CL-001" />
            <TextInput label="Numéro d’identité" value={form.identity_number} onChange={(value) => update("identity_number", value)} placeholder="NINEA, CNI, RCCM..." />

            <label className="block">
              <span className="text-xs font-bold text-mapgeo-primary">Type de client</span>
              <select
                value={form.type}
                onChange={(event) => update("type", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none"
              >
                <option value="entreprise">Entreprise</option>
                <option value="particulier">Particulier</option>
                <option value="institution">Institution</option>
              </select>
            </label>

            <TextInput label="Commune ou zone" value={form.address} onChange={(value) => update("address", value)} placeholder="Ex. Thiès" />

            <label className="block">
              <span className="text-xs font-bold text-mapgeo-primary">Statut</span>
              <select
                value={form.status}
                onChange={(event) => update("status", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none"
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </FormSection>

          <FormSection title="2. Contact">
            <TextInput label="Nom du contact" required value={form.first_name} onChange={(value) => update("first_name", value)} placeholder="Ex. Aminata Ndiaye" />
            <TextInput label="Email" required value={form.email} onChange={(value) => update("email", value)} placeholder="Ex. aminata@senagri.sn" />
            <TextInput label="Téléphone" value={form.phone} onChange={(value) => update("phone", value)} placeholder="Ex. +221 77 123 45 67" />
            {!editingClient ? (
              <TextInput label="Nom d’utilisateur optionnel" value={form.username} onChange={(value) => update("username", value)} placeholder="Ex. senagri" />
            ) : null}
          </FormSection>

          <FormSection title="3. Accès portail">
            <ToggleInput
              label={editingClient ? "Compte portail actif" : "Activer l’accès portail"}
              checked={form.portalAccess}
              disabled={Boolean(editingClient) && !hasPrimaryUser}
              onChange={(value) => update("portalAccess", value)}
            />

            <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 p-3 text-xs font-semibold text-mapgeo-secondary">
              Rôle portail : <span className="font-extrabold text-mapgeo-primary">Client</span>. Les rôles internes se gèrent dans Paramètres → Utilisateurs.
            </div>

            {editingClient && !hasPrimaryUser ? (
              <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-3 text-xs font-semibold text-mapgeo-primary">
                Aucun compte portail principal n’est lié à ce client. Créez un utilisateur client depuis Paramètres → Utilisateurs pour lui donner accès.
              </div>
            ) : null}

            {!editingClient && form.portalAccess ? (
              <ToggleInput label="Envoyer une invitation" checked={form.sendInvitation} onChange={(value) => update("sendInvitation", value)} />
            ) : null}

            {!editingClient && form.portalAccess && !form.sendInvitation ? (
              <PasswordInput
                label="Mot de passe initial"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
              />
            ) : null}

            {!editingClient && !form.portalAccess ? (
              <div className="rounded-2xl border border-mapgeo-line bg-white p-3 text-xs font-semibold text-mapgeo-secondary">
                Aucun e-mail d’activation ne sera envoyé tant que l’accès portail est désactivé.
              </div>
            ) : null}
          </FormSection>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-mapgeo-line pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={18} /> {saving ? "Traitement en cours…" : editingClient ? "Mettre à jour" : "Créer le client"}
          </button>
        </div>
      </form>
    </section>
  );
}

function FormSection({ title, children }) {
  return (
    <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/25 p-4">
      <h4 className="text-sm font-extrabold text-mapgeo-primary">{title}</h4>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text", required = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-mapgeo-primary">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none focus:border-mapgeo-accent"
      />
    </label>
  );
}

function ConfirmDialog({ action, loading, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mapgeo-primary/35 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel">
        <h3 className="text-2xl font-extrabold text-mapgeo-primary">{action.title}</h3>
        <p className="mt-3 text-sm leading-6 text-mapgeo-secondary">{action.message}</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Traitement..." : action.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleInput({ label, checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-left text-sm font-semibold text-mapgeo-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span>{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-mapgeo-primary" : "bg-mapgeo-sand/45"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

export default function ClientsPage() {
  const { user } = useAuth();
  const canCreateClients = user?.role === "admin";
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingClient, setEditingClient] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionSaving, setActionSaving] = useState(false);

  const normalizedClients = useMemo(() => {
    return clients.map(normalizeClient);
  }, [clients]);

  const filteredClients = useMemo(() => {
    return normalizedClients.filter((client) => {
      const q = filters.q.trim().toLowerCase();
      const locationText = clientLocationText(client);
      const matchesQuery =
        !q ||
        [client.name, client.code, client.metadata?.identity_number, client.email, client.phone, locationText, client.contact_name, client.portal_access]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(q));

      const matchesStatus = !filters.status || client.status === filters.status;
      const communeQuery = filters.commune.trim().toLowerCase();
      const matchesCommune = !communeQuery || locationText.toLowerCase().includes(communeQuery);
      const parcelCount = Number(client.parcels_count || 0);

      const matchesParcelRange =
        !filters.parcelRange ||
        (filters.parcelRange === "none" && parcelCount === 0) ||
        (filters.parcelRange === "has" && parcelCount > 0) ||
        (filters.parcelRange === "1-10" && parcelCount >= 1 && parcelCount <= 10) ||
        (filters.parcelRange === "10+" && parcelCount > 10);

      return matchesQuery && matchesStatus && matchesCommune && matchesParcelRange && matchesActivityPeriod(client, filters.activity);
    });
  }, [filters, normalizedClients]);

  const metrics = useMemo(() => {
    const active = normalizedClients.filter((client) => client.status === "active").length;
    const prospects = normalizedClients.filter((client) => client.status === "prospect").length;
    const inactive = normalizedClients.filter((client) => client.status === "inactive").length;
    const portfolios = normalizedClients.filter((client) => Number(client.parcels_count || 0) > 0).length;

    return { active, prospects, inactive, portfolios };
  }, [normalizedClients]);

  async function loadClients() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchAllClients({ ordering: "name" });
      setClients(data.results || []);
    } catch (err) {
      setError(getErrorMessage(err, "Impossible de charger les clients."));
      setClients([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  function startCreate() {
    if (!canCreateClients) {
      setError("Seul un administrateur peut créer une nouvelle organisation cliente.");
      return;
    }
    setEditingClient(null);
    setForm(emptyForm);
    setSuccess("");
    setError("");
  }

  function resetForm() {
    setEditingClient(null);
    setForm(emptyForm);
    setError("");
    setSuccess("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = payloadFrom(form, Boolean(editingClient));

      if (!payload.name || !payload.code) {
        setError("Le nom et le code client sont obligatoires.");
        return;
      }

      if (!form.first_name.trim()) {
        setError("Le nom du contact est obligatoire.");
        return;
      }

      if (!payload.email) {
        setError("L’e-mail du contact est obligatoire.");
        return;
      }

      if (!editingClient && !canCreateClients) {
        setError("Seul un administrateur peut créer une nouvelle organisation cliente.");
        return;
      }

      if (!editingClient && payload.portal_access && payload.send_invitation && !payload.email) {
        setError("L’e-mail est obligatoire pour envoyer une invitation d’activation.");
        return;
      }

      if (!editingClient && payload.portal_access && !payload.send_invitation && !payload.password) {
        setError("Définis un mot de passe initial ou active l’envoi d’une invitation sécurisée.");
        return;
      }

      if (editingClient) {
        if (form.portalAccess && payload.status === "inactive") {
          payload.status = "active";
        }

        await updateClient(editingClient.id, payload);

        const desiredPortalAccess = Boolean(form.portalAccess);
        const currentPortalAccess = isPortalAccessEnabled(editingClient);
        if (editingClient.primary_user_id && desiredPortalAccess !== currentPortalAccess) {
          if (desiredPortalAccess) {
            await activateUser(editingClient.primary_user_id);
          } else {
            await deactivateUser(editingClient.primary_user_id);
          }
        }

        setSuccess("Client mis à jour avec succès.");
      } else {
        const created = await createClient(payload);
        const organization = created?.organization;
        const login = created?.user?.client_code || created?.user?.username || payload.code;
        const activationInfo = created?.activation_url
          ? ` Lien d’activation dev : ${created.activation_url}`
          : "";
        const accessMessage = payload.portal_access
          ? created?.invitation_sent
            ? "Invitation envoyée par e-mail."
            : "Invitation non envoyée."
          : "Accès portail désactivé.";

        setSuccess(
          `Client ${organization?.name || payload.name} créé. Identifiant portail : ${login}. ${accessMessage}${activationInfo}`
        );
      }

      setEditingClient(null);
      setForm(emptyForm);
      await loadClients();
    } catch (err) {
      setError(getErrorMessage(err, "Enregistrement impossible."));
    } finally {
      setSaving(false);
    }
  }

  function requestDeactivateClient(client) {
    setError("");
    setSuccess("");
    setPendingAction({
      type: "deactivate",
      client,
      title: "Désactiver ce client ?",
      message: `Le client ${client.name} passera en statut inactif. Son compte portail principal sera aussi désactivé s’il existe.`,
      confirmLabel: "Désactiver",
    });
  }

  function requestDeleteClient(client) {
    setError("");
    setSuccess("");
    setPendingAction({
      type: "delete",
      client,
      title: "Supprimer ce client ?",
      message: `Le client ${client.name} sera supprimé définitivement. Cette action est irréversible. Les clients contenant des parcelles ou des couches cartographiques ne peuvent pas être supprimés.`,
      confirmLabel: "Supprimer le client",
    });
  }

  function requestResetAccess(client) {
    setError("");
    setSuccess("");

    if (!client.primary_user_id) {
      setError("Aucun compte portail principal n’est lié à ce client.");
      return;
    }

    setPendingAction({
      type: "reset-access",
      client,
      title: !isPortalAccessEnabled(client) ? "Réactiver l’accès portail ?" : "Réinitialiser l’accès portail ?",
      message: shouldDisableClient(client) || !isPortalAccessEnabled(client)
        ? `Le client ${client.name} sera réactivé côté organisation et compte portail. Un lien sécurisé sera envoyé si une adresse e-mail est associée au compte.`
        : `Un lien sécurisé de réinitialisation sera envoyé à ${client.name} si une adresse e-mail est associée au compte.`,
      confirmLabel: !isPortalAccessEnabled(client) ? "Réactiver" : "Réinitialiser",
    });
  }

  async function executePendingAction() {
    if (!pendingAction?.client) return;

    const { client, type } = pendingAction;
    setActionSaving(true);
    setError("");
    setSuccess("");

    try {
      if (type === "deactivate") {
        await updateClient(client.id, { status: "inactive" });

        if (client.primary_user_id) {
          await deactivateUser(client.primary_user_id);
        }

        await loadClients();
        setSuccess(`Client ${client.name} désactivé.`);
        if (editingClient?.id === client.id) resetForm();
      }

      if (type === "delete") {
        await deleteClient(client.id);
        await loadClients();
        setSuccess(`Client ${client.name} supprimé.`);
        if (editingClient?.id === client.id) resetForm();
      }

      if (type === "reset-access") {
        if (shouldDisableClient(client)) {
          await updateClient(client.id, { status: "active" });
        }

        if (!isPortalAccessEnabled(client) && client.primary_user_id) {
          await activateUser(client.primary_user_id);
        }

        const result = await resetClientAccess(client.primary_user_id);
        const suffix = result?.reset_sent
          ? " Un lien sécurisé a été envoyé par e-mail."
          : " Aucun e-mail n’a pu être envoyé.";
        setSuccess(`Accès portail mis à jour pour ${client.name}.${suffix}`);
        await loadClients();
      }

      setPendingAction(null);
    } catch (err) {
      setError(getErrorMessage(err, type === "reset-access" ? "Réinitialisation d’accès impossible." : type === "delete" ? "Suppression impossible." : "Désactivation impossible."));
    } finally {
      setActionSaving(false);
    }
  }

  return (
    <DashboardLayout title="Clients" subtitle="Gérez les comptes clients, leurs portefeuilles et leurs accès portail.">
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Clients
            </nav>
            <p className="mt-2 max-w-2xl text-sm text-mapgeo-secondary/70 lg:hidden">
              Gérez les comptes clients, leurs portefeuilles et leurs accès portail.
            </p>
          </div>

          {canCreateClients ? (
            <button
              type="button"
              onClick={startCreate}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
            >
              <Plus size={18} /> Nouveau client
            </button>
          ) : null}
        </section>

        <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
          <KpiCard icon={UserRound} label="Clients actifs" value={formatNumber(metrics.active)} description="Comptes opérationnels" action="Voir les clients actifs" onClick={() => setFilters({ ...emptyFilters, status: "active" })} tone="blue" />
          <KpiCard icon={UserPlus} label="Prospects" value={formatNumber(metrics.prospects)} description="Comptes à convertir" action="Voir les prospects" onClick={() => setFilters({ ...emptyFilters, status: "prospect" })} tone="purple" />
          <KpiCard icon={BriefcaseBusiness} label="Portefeuilles ouverts" value={formatNumber(metrics.portfolios)} description="Clients avec parcelles" action="Voir les portefeuilles" onClick={() => setFilters({ ...emptyFilters, parcelRange: "has" })} tone="green" />
          <KpiCard icon={UsersRound} label="Clients inactifs" value={formatNumber(metrics.inactive)} description="Comptes à relancer" action="Voir les inactifs" onClick={() => setFilters({ ...emptyFilters, status: "inactive" })} tone="orange" />
        </section>

        <FilterBar filters={filters} onChange={setFilters} onReset={() => setFilters(emptyFilters)} />

        {error ? (
          <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-4 py-3 text-sm font-medium text-mapgeo-primary">{error}</div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 px-4 py-3 text-sm font-medium text-mapgeo-primary">{success}</div>
        ) : null}

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <ClientsTable
            clients={filteredClients}
            loading={loading}
            actionSaving={actionSaving}
            onDeleteClient={requestDeleteClient}
            onDelete={requestDeactivateClient}
            onResetAccess={requestResetAccess}
          />
          <ClientSummary clients={normalizedClients} user={user} onSelectAlert={(filter) => setFilters({ ...emptyFilters, ...filter })} />
        </section>

        {pendingAction ? (
          <ConfirmDialog
            action={pendingAction}
            loading={actionSaving}
            onCancel={() => {
              if (!actionSaving) setPendingAction(null);
            }}
            onConfirm={executePendingAction}
          />
        ) : null}

        {canCreateClients || editingClient ? (
          <ClientFormPanel
            form={form}
            setForm={setForm}
            editingClient={editingClient}
            saving={saving}
            onSubmit={handleSubmit}
            onCancel={resetForm}
          />
        ) : null}
      </div>
    </DashboardLayout>
  );
}
