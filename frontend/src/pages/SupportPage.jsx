import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  History,
  Mail,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Ticket,
  Trash2,
  UploadCloud,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import supportService from "../services/supportService";
import { fetchAllClients } from "../services/clientService";
import { getErrorMessage } from "../services/responseUtils";
import useParcelSearch, { formatParcelOptionLabel } from "../hooks/useParcelSearch";
import {
  SUPPORT_ATTACHMENT_ACCEPT,
  SUPPORT_ATTACHMENT_FORMATS_LABEL,
  SUPPORT_ATTACHMENT_MAX_SIZE_LABEL,
  SUPPORT_RESOLVED_STATUSES,
  SUPPORT_STATUS_LABELS,
  getSupportPriorityLabel,
  getSupportStatusLabel,
  isResolvedOrClosed,
  validateSupportAttachment,
} from "../constants/supportConstants";
import { getRoleLabel } from "../constants/roleConstants";
import { formatDateLabel } from "../utils/dateUtils";
import LoadingState from "../components/ui/LoadingState";

const EMPTY_FILTERS = {
  q: "",
  status: "",
  priority: "",
  category: "",
  organization_code: "",
  parcel: "",
  period: "",
};

const EMPTY_TICKET_FORM = {
  subject: "",
  category: "",
  priority: "medium",
  client: "",
  parcel: "",
  description: "",
  attachment: null,
};


const CATEGORY_OPTIONS = ["Document", "Parcelle", "Accès", "Bug", "Demande métier", "Facturation"];

function normalizeStatus(status) {
  if (status === "pending") return "open";
  return status || "open";
}

function normalizePriority(priority) {
  if (priority === "critical") return "urgent";
  if (priority === "normal") return "medium";
  return priority || "medium";
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function statusLabel(status) {
  return getSupportStatusLabel(status);
}

function priorityLabel(priority) {
  return getSupportPriorityLabel(priority);
}

function ticketMatchesPeriod(ticket, period) {
  if (!period) return true;

  const sourceDate = ticket.last_reply_at || ticket.updated_at || ticket.created_at;
  if (!sourceDate) return false;

  const date = new Date(sourceDate);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();

  if (period === "today") {
    return date.toDateString() === now.toDateString();
  }

  const start = new Date(now);
  if (period === "week" || period === "7days") {
    start.setDate(now.getDate() - 7);
  } else if (period === "month") {
    start.setMonth(now.getMonth() - 1);
  } else {
    return true;
  }

  return date >= start;
}

function formatDate(value) {
  return formatDateLabel(value, "—", { day: "2-digit", month: "2-digit", year: "numeric" });
}


function clientDisplayName(client) {
  return client?.primary_user_name
    || client?.company_name
    || client?.name
    || client?.code
    || client?.label
    || "Client";
}

function clientFilterValue(client = {}) {
  return String(client.code || client.primary_user_client_code || client.client_code || "").trim();
}

function clientFilterLabel(client = {}) {
  const name = clientDisplayName(client);
  const code = clientFilterValue(client);
  return code && name !== code ? `${name} · ${code}` : name || code || "Client";
}

function clientAccountValue(client = {}) {
  return String(client.primary_user_id || client.user_id || client.client_user_id || "").trim();
}

function clientAccountLabel(client = {}) {
  const accountName = client.primary_user_name || client.user_name || clientDisplayName(client);
  const orgCode = clientFilterValue(client);
  return orgCode ? `${accountName} · ${orgCode}` : accountName;
}

function buildTicketPayload(form, isInternalPortal) {
  const payload = {
    subject: form.subject.trim(),
    category: form.category || "Demande métier",
    priority: form.priority,
    message: form.description.trim(),
  };
  if (form.parcel) payload.parcel = form.parcel;
  if (isInternalPortal && form.client) payload.client = form.client;
  return payload;
}

function normalizeTicket(ticket, index = 0) {
  const status = normalizeStatus(ticket.status);
  const priority = normalizePriority(ticket.priority);
  const reference = ticket.reference || ticket.code || `SUP-${String(184 + index).padStart(3, "0")}`;

  return {
    ...ticket,
    id: ticket.id || reference,
    reference,
    subject: ticket.subject || ticket.title || "Demande support",
    client: ticket.client_name || ticket.user_name || ticket.organization_name || ticket.client?.name || ticket.user?.name || ticket.organization?.name || ticket.user_client_code || ticket.client || "Client",
    clientCode: ticket.user_client_code || ticket.client_code || ticket.client?.code || ticket.user?.client_code || "",
    organization: ticket.organization || ticket.organization_id || "",
    organizationName: ticket.organization_name || ticket.organization?.name || ticket.client?.organization_name || "",
    organizationCode: ticket.organization_code || ticket.organizationCode || ticket.organization?.code || ticket.client?.organization_code || ticket.client?.code || ticket.user?.organization_code || "",
    parcel: ticket.parcel_reference || ticket.parcel_code || ticket.parcel || "—",
    category: ticket.category_label || ticket.category || "Demande métier",
    priority,
    status,
    lastReply: ticket.lastReply || ticket.last_reply_at_label || formatDate(ticket.last_reply_at || ticket.updated_at || ticket.created_at),
    hasAttachment: Boolean(ticket.has_attachment || ticket.attachment_count || (ticket.messages || []).some((message) => message.attachment_url || message.attachment_name || message.attachment)),
    attachmentCount: Number(ticket.attachment_count || 0),
    href: ticket.href || "/support",
    isMock: Boolean(ticket.isMock),
  };
}

function statusClasses(status) {
  if (status === "open") return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  if (status === "in_progress") return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (status === "resolved") return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (status === "closed") return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/75";
  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary";
}

function priorityClasses(priority) {
  if (priority === "low") return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (priority === "medium") return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  if (priority === "high") return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (priority === "urgent") return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary";
}

function categoryClasses(category) {
  const value = String(category || "").toLowerCase();

  if (value.includes("document")) return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  if (value.includes("parcelle")) return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  if (value.includes("accès")) return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  if (value.includes("bug")) return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";

  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary";
}

function KpiCard({ icon: Icon, label, value, description, action, onClick, tone = "blue" }) {
  const tones = {
    blue: "bg-mapgeo-sand/15 text-mapgeo-primary",
    amber: "bg-mapgeo-sand/10 text-mapgeo-primary",
    red: "bg-mapgeo-sand/10 text-mapgeo-primary",
    green: "bg-mapgeo-primary/6 text-mapgeo-primary",
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

function FilterBar({ filters, setFilters, onReset, isInternalPortal, clients = [], parcels = [] }) {
  const update = (name, value) => setFilters((current) => ({ ...current, [name]: value }));

  const gridClassName = isInternalPortal
    ? "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.05fr)_minmax(0,150px)]"
    : "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,0.9fr)_minmax(0,1.05fr)_minmax(0,150px)]";

  return (
    <section className="overflow-hidden rounded-3xl border border-mapgeo-line bg-white p-4 shadow-soft">
      <div className={gridClassName}>
        <label className="min-w-0 space-y-1.5">
          <span className="text-xs font-bold text-mapgeo-primary/80">Recherche</span>

          <div className="flex h-11 min-w-0 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm focus-within:border-mapgeo-primary/40 focus-within:ring-4 focus-within:ring-mapgeo-primary/5">
            <Search size={16} className="shrink-0 text-mapgeo-secondary/60" />

            <input
              value={filters.q}
              onChange={(event) => update("q", event.target.value)}
              placeholder={
                isInternalPortal
                  ? "Rechercher un ticket, client, parcelle..."
                  : "Rechercher une demande, parcelle..."
              }
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
            />
          </div>
        </label>

        <SelectField label="Statut" value={filters.status} onChange={(value) => update("status", value)}>
          <option value="">Tous</option>

          {Object.entries(SUPPORT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}

          <option value="resolved_or_closed">Résolus / clôturés</option>
        </SelectField>

        <SelectField label="Priorité" value={filters.priority} onChange={(value) => update("priority", value)}>
          <option value="">Toutes</option>
          <option value="low">{priorityLabel("low")}</option>
          <option value="medium">{priorityLabel("medium")}</option>
          <option value="high">{priorityLabel("high")}</option>
          {isInternalPortal ? <option value="urgent">{priorityLabel("urgent")}</option> : null}
        </SelectField>

        <SelectField label="Catégorie" value={filters.category} onChange={(value) => update("category", value)}>
          <option value="">Toutes</option>

          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </SelectField>

        {isInternalPortal ? (
          <SelectField
            label="Client"
            value={filters.organization_code}
            onChange={(value) => update("organization_code", value)}
          >
            <option value="">Tous</option>

            {clients.map((client) => {
              const label = clientFilterLabel(client);
              const value = clientFilterValue(client);

              return label ? (
                <option key={value || label} value={value}>
                  {label}
                </option>
              ) : null;
            })}
          </SelectField>
        ) : null}

        <SelectField label="Parcelle" value={filters.parcel} onChange={(value) => update("parcel", value)}>
          <option value="">Toutes</option>

          {parcels.map((parcel) => {
            const label = parcel.reference || parcel.parcel_reference || parcel.code;

            return label ? (
              <option key={parcel.id || label} value={label}>
                {label}
              </option>
            ) : null;
          })}
        </SelectField>

        <SelectField
          label="Période"
          value={filters.period}
          onChange={(value) => update("period", value)}
          icon={CalendarDays}
        >
          <option value="">Toutes</option>
          <option value="7days">7 derniers jours</option>
          <option value="today">Aujourd’hui</option>
          <option value="week">Cette semaine</option>
          <option value="month">Ce mois-ci</option>
        </SelectField>

        <div className="flex min-w-0 items-end">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-11 w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-mapgeo-line bg-white px-3 text-sm font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory"
          >
            <RefreshCcw size={16} className="shrink-0" />
            <span className="truncate">Réinitialiser</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function SelectField({ label, value, onChange, children, icon: Icon }) {
  return (
    <label className="min-w-0 space-y-1.5">
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>

      <div className="flex h-11 min-w-0 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
        {Icon ? <Icon size={16} className="shrink-0 text-mapgeo-secondary/60" /> : null}

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

function TicketsTable({
  tickets,
  loading,
  error,
  onClose,
  onDelete,
  isInternalPortal,
  canManageSupport,
  selectedIds,
  deletingTicketId,
  bulkDeleting,
  onToggleSelected,
  onToggleVisibleSelection,
  onDeleteSelected,
}) {
  const selectableTickets = canManageSupport ? tickets.filter((ticket) => ticket.id && !ticket.isMock) : [];
  const selectedCount = selectedIds?.size || 0;
  const visibleSelected = selectableTickets.filter((ticket) => selectedIds?.has(ticket.id)).length;
  const allVisibleSelected = selectableTickets.length > 0 && visibleSelected === selectableTickets.length;

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-mapgeo-line p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">
            {isInternalPortal ? "Liste des tickets" : "Mes demandes"}
          </h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            {isInternalPortal
              ? "Suivez les demandes, priorités et dernières réponses."
              : "Suivez vos demandes, leur statut et les dernières réponses."}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canManageSupport ? (
            <>
              <label className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-extrabold text-mapgeo-primary shadow-sm">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={!selectableTickets.length || bulkDeleting}
                  onChange={() => onToggleVisibleSelection(selectableTickets, !allVisibleSelected)}
                />
                Tout sélectionner
              </label>
              <button
                type="button"
                onClick={onDeleteSelected}
                disabled={!selectedCount || bulkDeleting}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white px-3 py-2 text-xs font-extrabold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={15} /> Supprimer {selectedCount ? `(${selectedCount})` : ""}
              </button>
            </>
          ) : null}
          <div className="inline-flex items-center gap-2 text-xs font-medium text-mapgeo-secondary/70">
            Données synchronisées avec le backend
            <RefreshCcw size={15} className="text-mapgeo-primary" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-6">
          <LoadingState
            title="Veuillez patienter"
            message="Mise à jour des demandes support."
            compact
          />
        </div>
      ) : null}

      {error ? (
        <div className="m-6 rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm font-medium text-mapgeo-primary">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="overflow-x-auto">
          <table className="min-w-[1040px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
                {canManageSupport ? <th className="w-12 px-5 py-4" aria-label="Sélection" /> : null}
                <th className="px-5 py-4">Référence</th>
                <th className="px-4 py-4">Sujet</th>
                {isInternalPortal ? <th className="px-4 py-4">Client</th> : null}
                <th className="px-4 py-4">Parcelle</th>
                <th className="px-4 py-4">Catégorie</th>
                <th className="px-4 py-4">Priorité</th>
                <th className="px-4 py-4">Statut</th>
                <th className="px-4 py-4">Dernière réponse</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-mapgeo-line">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="transition hover:bg-mapgeo-ivory/40">
                  {canManageSupport ? (
                    <td className="px-5 py-4">
                      <label className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-mapgeo-line bg-white shadow-sm">
                        <input
                          type="checkbox"
                          checked={selectedIds?.has(ticket.id) || false}
                          disabled={!ticket.id || ticket.isMock || bulkDeleting || deletingTicketId === ticket.id}
                          onChange={() => onToggleSelected(ticket.id)}
                          aria-label={`Sélectionner ${ticket.reference}`}
                        />
                      </label>
                    </td>
                  ) : null}
                  <td className="px-5 py-4 font-extrabold text-mapgeo-primary">{ticket.reference}</td>
                  <td className="px-4 py-4 font-semibold text-mapgeo-primary">
                    <div className="flex items-center gap-2">
                      <span>{ticket.subject}</span>
                      {ticket.hasAttachment ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-mapgeo-line bg-mapgeo-ivory px-2 py-0.5 text-[10px] font-bold text-mapgeo-secondary" title={`${ticket.attachmentCount || 1} pièce(s) jointe(s)`}>
                          <Paperclip size={12} /> PJ
                        </span>
                      ) : null}
                    </div>
                  </td>

                  {isInternalPortal ? <td className="px-4 py-4 text-mapgeo-secondary">{ticket.client}</td> : null}

                  <td className="px-4 py-4 text-mapgeo-secondary">{ticket.parcel}</td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${categoryClasses(ticket.category)}`}>
                      {ticket.category}
                    </span>
                  </td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${priorityClasses(ticket.priority)}`}>
                      {priorityLabel(ticket.priority)}
                    </span>
                  </td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${statusClasses(ticket.status)}`}>
                      {statusLabel(ticket.status)}
                    </span>
                  </td>

                  <td className="px-4 py-4 text-mapgeo-secondary">{ticket.lastReply}</td>

                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/support/${ticket.id}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory"
                      >
                        Ouvrir <ExternalLink size={13} />
                      </Link>

                      {ticket.status !== "resolved" && ticket.status !== "closed" ? (
                        <Link
                          to={`/support/${ticket.id}`}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-sand/15"
                        >
                          Répondre <MessageCircle size={13} />
                        </Link>
                      ) : null}

                      {canManageSupport && ticket.status !== "resolved" && ticket.status !== "closed" ? (
                        <button
                          type="button"
                          onClick={() => onClose(ticket)}
                          disabled={bulkDeleting || deletingTicketId === ticket.id}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Clôturer <CheckCircle2 size={13} />
                        </button>
                      ) : null}

                      {canManageSupport ? (
                        <button
                          type="button"
                          onClick={() => onDelete(ticket)}
                          disabled={bulkDeleting || deletingTicketId === ticket.id}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 size={13} /> Supprimer
                        </button>
                      ) : null}

                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {tickets.length === 0 ? (
            <div className="p-6 text-center text-sm text-mapgeo-secondary">
              Aucun ticket ne correspond aux filtres sélectionnés.
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="flex justify-center border-t border-mapgeo-line px-6 py-5">
          <Link to="/support" className="inline-flex items-center gap-2 text-sm font-extrabold text-mapgeo-primary transition hover:gap-3">
            {isInternalPortal ? "Voir tous les tickets" : "Voir toutes mes demandes"} <ChevronRight size={16} />
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function TicketForm({ form, setForm, clients, parcels, parcelQuery, setParcelQuery, parcelLoading, parcelError, submitting, onSubmit, onCancel, isInternalPortal, attachmentError = "", onAttachmentChange }) {
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  return (
    <section id="new-ticket" className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
          <Ticket size={20} />
        </div>

        <div>
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">Nouvelle demande</h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            {isInternalPortal
              ? "Décrivez la demande et rattachez-la au client ou à la parcelle concernée."
              : "Décrivez votre demande et rattachez-la à une parcelle si nécessaire."}
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div className={isInternalPortal ? "grid grid-cols-1 gap-4 lg:grid-cols-4" : "grid grid-cols-1 gap-4 lg:grid-cols-3"}>
          <TextInput
            label="Sujet"
            required
            value={form.subject}
            onChange={(value) => update("subject", value)}
            placeholder="Ex. Problème d’accès à un document"
            disabled={submitting}
          />

          <SelectInput label="Catégorie" required value={form.category} onChange={(value) => update("category", value)} disabled={submitting}>
            <option value="">Sélectionner une catégorie</option>
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </SelectInput>

          <SelectInput label="Priorité" required value={form.priority} onChange={(value) => update("priority", value)} disabled={submitting}>
            <option value="low">Basse</option>
            <option value="medium">Normale</option>
            <option value="high">Haute</option>
            {isInternalPortal ? <option value="urgent">Urgente</option> : null}
          </SelectInput>

          {isInternalPortal ? (
            <SelectInput label="Compte client" required={!form.parcel} value={form.client} onChange={(value) => update("client", value)} disabled={submitting}>
              <option value="">Sélectionner un compte client</option>
              {clients.map((client) => (
                <option key={client.id || client.name} value={client.id || client.name}>
                  {client.name || client.code || client.label}
                </option>
              ))}
            </SelectInput>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs font-bold text-mapgeo-primary">Recherche parcelle</span>
              <input
                value={parcelQuery}
                onChange={(event) => setParcelQuery(event.target.value)}
                disabled={submitting}
                placeholder="Référence, client ou commune"
                className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none focus:border-mapgeo-accent disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <div className="min-h-[1rem] text-xs font-semibold text-mapgeo-secondary">
              {parcelLoading ? "Recherche des parcelles…" : null}
              {!parcelLoading && parcelError ? <span className="text-red-600">{parcelError}</span> : null}
              {!parcelLoading && !parcelError && parcels.length ? `${parcels.length} parcelle(s) proposée(s)` : null}
            </div>
            <SelectInput label="Parcelle liée" value={form.parcel} onChange={(value) => update("parcel", value)} disabled={submitting}>
              <option value="">Sélectionner une parcelle (optionnel)</option>
              {parcels.map((parcel) => (
                <option key={parcel.id} value={parcel.id}>
                  {formatParcelOptionLabel(parcel)}
                </option>
              ))}
            </SelectInput>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-mapgeo-primary">Description *</span>
            <textarea
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Décrivez votre demande en détail..."
              rows="4"
              required
              disabled={submitting}
              className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none focus:border-mapgeo-accent disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="block">
            <span className="text-xs font-bold text-mapgeo-primary">Pièce jointe (optionnel)</span>
            <div className="mt-2 flex min-h-[86px] cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-mapgeo-sand/60 bg-mapgeo-sand/15 px-4 py-4 text-center transition hover:bg-mapgeo-sand/15">
              <UploadCloud size={24} className="text-mapgeo-primary" />
              <div>
                <p className="text-sm font-semibold text-mapgeo-primary">{form.attachment?.name || "Glissez vos fichiers ici ou cliquez pour parcourir"}</p>
                <p className="text-xs text-mapgeo-secondary/70">Formats acceptés : {SUPPORT_ATTACHMENT_FORMATS_LABEL} (Max. {SUPPORT_ATTACHMENT_MAX_SIZE_LABEL})</p>
              </div>
              <input type="file" className="hidden" accept={SUPPORT_ATTACHMENT_ACCEPT} disabled={submitting} onChange={(event) => onAttachmentChange(event.target.files?.[0] || null)} />
            </div>
            {attachmentError ? <p className="mt-2 text-xs font-bold text-mapgeo-primary">{attachmentError}</p> : null}
          </label>

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annuler
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send size={17} /> {submitting ? "Création..." : "Créer le ticket"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function TextInput({ label, value, onChange, placeholder, required = false, disabled = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-mapgeo-primary">{label}{required ? " *" : ""}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none focus:border-mapgeo-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function SelectInput({ label, value, onChange, children, required = false, disabled = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-mapgeo-primary">{label}{required ? " *" : ""}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none focus:border-mapgeo-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {children}
      </select>
    </label>
  );
}

function SupportSummary({ metrics, user, onShowUrgent, onShowOpen, isInternalPortal }) {
  return (
    <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl" />

      <div className="relative">
        <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">
          {isInternalPortal ? "Résumé support" : "Résumé de mes demandes"}
        </h3>

        <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
          <SummaryMetric icon={Ticket} label={isInternalPortal ? "Tickets ouverts" : "Demandes ouvertes"} value={formatNumber(metrics.open)} />
          <SummaryMetric icon={Clock3} label="En cours" value={formatNumber(metrics.inProgress)} />
          <SummaryMetric icon={AlertTriangle} label={isInternalPortal ? "Urgents" : "Priorité haute"} value={formatNumber(isInternalPortal ? metrics.urgent : metrics.high)} />
          <SummaryMetric icon={CheckCircle2} label="Résolus / clôturés" value={formatNumber(metrics.resolved)} />
          <SummaryMetric icon={Clock3} label="Dernier accès" value={user?.username || "client"} />
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/75">Contact MAPGEO</h4>
          <div className="mt-3 space-y-3 text-sm">
            <SummaryMetric icon={Mail} label="support@mapgeo.sn" value="" />
            <SummaryMetric icon={Phone} label="+221 33 000 00 00" value="" />
            <SummaryMetric icon={Clock3} label="Horaires : Lun–Ven • 08:30–18:00" value="" />
            <SummaryMetric icon={CalendarDays} label={isInternalPortal ? "Délai estimé : 2 h urgent / 24 h standard" : "Délai estimé : 24 h standard"} value="" />
          </div>
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/75">Actions rapides</h4>

          <div className="mt-3 space-y-2">
            {isInternalPortal ? (
              <>
                <QuickAction icon={AlertTriangle} label="Voir les tickets urgents" onClick={onShowUrgent} />
                <QuickAction icon={MessageCircle} label="Répondre aux tickets ouverts" onClick={onShowOpen} />
                <QuickAction icon={History} label="Consulter l’historique des demandes" href="/support" />
              </>
            ) : (
              <>
                <QuickAction icon={Ticket} label="Voir mes demandes ouvertes" onClick={onShowOpen} />
                <QuickAction icon={MessageCircle} label="Créer une nouvelle demande" href="#new-ticket" />
                <QuickAction icon={History} label="Consulter mon historique" href="/support" />
              </>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Portail</p>
            <p className="mt-1 font-extrabold">{isInternalPortal ? "Interne" : "Client"}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Rôle</p>
            <p className="mt-1 font-extrabold">{isInternalPortal ? getRoleLabel(user?.role) : "Client"}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}


function TicketDeleteDialog({ ticket, ticketCount = 1, loading, onCancel, onConfirm }) {
  const isBulk = ticketCount > 1;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-mapgeo-primary/40 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirmation de suppression">
      <div className="w-full max-w-lg rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel">
        <h3 className="text-xl font-extrabold text-mapgeo-primary">{isBulk ? "Supprimer les tickets sélectionnés ?" : "Supprimer le ticket ?"}</h3>
        <p className="mt-3 text-sm leading-6 text-mapgeo-secondary">
          {isBulk
            ? `${ticketCount} ticket(s) seront supprimé(s). Cette action est définitive.`
            : `Le ticket ${ticket?.reference || "sélectionné"}${ticket?.subject ? ` — ${ticket.subject}` : ""} sera supprimé. Cette action est définitive.`}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 size={17} /> {loading ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryMetric({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={17} className="text-white/70" />
      <span className="flex-1 text-white/80">{label}</span>
      {value ? <span className="font-extrabold text-white">{value}</span> : null}
    </div>
  );
}

function QuickAction({ icon: Icon, label, href, onClick }) {
  const className = "flex w-full items-center gap-3 rounded-2xl py-2 text-left text-sm font-semibold text-white/90 transition hover:bg-white/5";

  const content = (
    <>
      <Icon size={17} className="text-white/70" />
      <span className="flex-1">{label}</span>
      <ChevronRight size={16} className="text-white/60" />
    </>
  );

  if (href?.startsWith("#")) return <a href={href} className={className}>{content}</a>;
  if (href) return <Link to={href} className={className}>{content}</Link>;

  return <button type="button" onClick={onClick} className={className}>{content}</button>;
}

export default function SupportPage() {
  const { user, isInternalPortal } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageSupport = ["admin", "manager"].includes(user?.role);
  const [tickets, setTickets] = useState([]);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    q: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
    organization_code: searchParams.get("organization_code") || searchParams.get("client") || "",
  }));
  const [form, setForm] = useState(EMPTY_TICKET_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [closingTicketId, setClosingTicketId] = useState(null);
  const [deletingTicketId, setDeletingTicketId] = useState(null);
  const [bulkDeletingTickets, setBulkDeletingTickets] = useState(false);
  const [ticketToClose, setTicketToClose] = useState(null);
  const [ticketToDelete, setTicketToDelete] = useState(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState(new Set());
  const [attachmentError, setAttachmentError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const {
    parcels: formParcelOptions,
    loading: formParcelsLoading,
    error: formParcelsError,
    query: formParcelQuery,
    setQuery: setFormParcelQuery,
    refresh: refreshFormParcels,
  } = useParcelSearch({
    selectedParcelId: form.parcel,
    pageSize: 50,
    debounceMs: 300,
  });

  const normalizedTickets = useMemo(() => tickets.map(normalizeTicket), [tickets]);

  const filteredTickets = useMemo(() => {
    return normalizedTickets.filter((ticket) => {
      const q = filters.q.trim().toLowerCase();

      const matchesQuery =
        !q ||
        [ticket.reference, ticket.subject, ticket.client, ticket.parcel, ticket.category]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(q));

      const matchesStatus = !filters.status || (filters.status === "resolved_or_closed" ? SUPPORT_RESOLVED_STATUSES.includes(ticket.status) : ticket.status === filters.status);
      const matchesPriority = !filters.priority || ticket.priority === filters.priority;
      const matchesCategory = !filters.category || ticket.category === filters.category;
      const matchesClient = !isInternalPortal || !filters.organization_code || [
        ticket.organizationCode,
        ticket.clientCode,
        ticket.user_client_code,
      ].filter(Boolean).some((item) => String(item) === String(filters.organization_code));
      const matchesParcel = !filters.parcel || String(ticket.parcel) === String(filters.parcel) || String(ticket.parcel_reference || "") === String(filters.parcel);
      const matchesPeriod = ticketMatchesPeriod(ticket, filters.period);

      return matchesQuery && matchesStatus && matchesPriority && matchesCategory && matchesClient && matchesParcel && matchesPeriod;
    });
  }, [filters, normalizedTickets, isInternalPortal]);

  const ticketParcelOptions = useMemo(() => {
    const unique = new Map();
    normalizedTickets.forEach((ticket) => {
      if (!ticket.parcel || ticket.parcel === "—") return;
      unique.set(String(ticket.parcel), { id: String(ticket.parcel), reference: ticket.parcel });
    });
    return Array.from(unique.values());
  }, [normalizedTickets]);

  const metrics = useMemo(() => {
    const open = filteredTickets.filter((ticket) => ticket.status === "open").length;
    const inProgress = filteredTickets.filter((ticket) => ticket.status === "in_progress").length;
    const urgent = filteredTickets.filter((ticket) => ticket.priority === "urgent").length;
    const high = filteredTickets.filter((ticket) => ticket.priority === "high").length;
    const resolved = filteredTickets.filter((ticket) => isResolvedOrClosed(ticket.status)).length;

    return { open, inProgress, urgent, high, resolved };
  }, [filteredTickets]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const requests = [supportService.getTickets({ page: 1, page_size: 50 })];

      if (isInternalPortal) {
        requests.push(fetchAllClients({ ordering: "name" }));
      }

      const [ticketData, clientData] = await Promise.allSettled(requests);

      if (ticketData.status === "fulfilled") {
        const results = ticketData.value?.results || ticketData.value || [];
        setTickets(Array.isArray(results) ? results : []);
      }

      if (isInternalPortal && clientData?.status === "fulfilled") {
        const results = clientData.value?.results || clientData.value || [];
        setClients(Array.isArray(results) ? results : []);
      }

      if (ticketData.status === "rejected") {
        setError(getErrorMessage(ticketData.reason, "Impossible de charger les tickets."));
      }
    } finally {
      setLoading(false);
    }
  }, [isInternalPortal]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const existingIds = new Set(tickets.map((ticket) => ticket.id).filter(Boolean));
    setSelectedTicketIds((current) => {
      const next = new Set([...current].filter((id) => existingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [tickets]);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (filters.q) nextParams.set("q", filters.q);
    if (filters.organization_code) nextParams.set("organization_code", filters.organization_code);
    if (filters.status) nextParams.set("status", filters.status);
    setSearchParams(nextParams, { replace: true });
  }, [filters.organization_code, filters.q, filters.status, setSearchParams]);

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const handleAttachmentChange = (file) => {
    const validationError = validateSupportAttachment(file);
    setAttachmentError(validationError);
    setForm((current) => ({ ...current, attachment: validationError ? null : file }));
  };

  const handleCreateTicket = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      if (!form.subject.trim() || !form.description.trim()) {
        setError("Le sujet et la description sont obligatoires.");
        return;
      }

      if (isInternalPortal && !form.client && !form.parcel) {
        setError("Sélectionnez un client ou une parcelle liée avant de créer le ticket.");
        return;
      }

      const validationError = validateSupportAttachment(form.attachment);
      if (validationError) {
        setAttachmentError(validationError);
        setError(validationError);
        return;
      }

      const basePayload = buildTicketPayload(form, isInternalPortal);

      let payload = basePayload;
      if (form.attachment) {
        payload = new FormData();
        Object.entries(basePayload).forEach(([key, value]) => {
          if (value !== null && value !== undefined && value !== "") payload.append(key, value);
        });
        payload.append("initial_attachment", form.attachment);
      }

      await supportService.createTicket(payload);

      setForm(EMPTY_TICKET_FORM);
      setAttachmentError("");
      setMessage(
        form.attachment
          ? "Ticket créé avec succès. La pièce jointe a été transmise via une route sécurisée."
          : "Ticket créé avec succès."
      );
      await loadData();
      refreshFormParcels();
    } catch (createError) {
      setError(getErrorMessage(createError, "Impossible de créer le ticket."));
    } finally {
      setSubmitting(false);
    }
  };

  const requestCloseTicket = (ticket) => {
    if (!canManageSupport || !ticket?.id) return;
    setTicketToClose(ticket);
  };

  const confirmCloseTicket = async () => {
    if (!ticketToClose?.id) return;

    setClosingTicketId(ticketToClose.id);
    setMessage("");
    setError("");

    try {
      await supportService.closeTicket(ticketToClose.id);
      setMessage(`Ticket ${ticketToClose.reference} clôturé.`);
      setTicketToClose(null);
      await loadData();
    } catch (closeError) {
      setError(getErrorMessage(closeError, "Impossible de clôturer le ticket."));
    } finally {
      setClosingTicketId(null);
    }
  };

  const toggleSelectedTicket = (id) => {
    if (!id || !canManageSupport) return;
    setSelectedTicketIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleTickets = (items, shouldSelect) => {
    if (!canManageSupport) return;
    setSelectedTicketIds((current) => {
      const next = new Set(current);
      items.forEach((item) => {
        if (!item.id || item.isMock) return;
        if (shouldSelect) next.add(item.id);
        else next.delete(item.id);
      });
      return next;
    });
  };

  const requestDeleteTicket = (ticket) => {
    if (!canManageSupport || !ticket?.id) return;
    setTicketToDelete(ticket);
  };

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete?.id || !canManageSupport) return;

    setDeletingTicketId(ticketToDelete.id);
    setMessage("");
    setError("");

    try {
      await supportService.deleteTicket(ticketToDelete.id);
      setTickets((current) => current.filter((item) => item.id !== ticketToDelete.id));
      setSelectedTicketIds((current) => {
        const next = new Set(current);
        next.delete(ticketToDelete.id);
        return next;
      });
      setMessage(`Ticket ${ticketToDelete.reference} supprimé.`);
      setTicketToDelete(null);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Impossible de supprimer le ticket."));
    } finally {
      setDeletingTicketId(null);
    }
  };

  const requestDeleteSelectedTickets = () => {
    if (!canManageSupport || selectedTicketIds.size === 0) return;
    setPendingBulkDelete(true);
  };

  const confirmDeleteSelectedTickets = async () => {
    if (!canManageSupport || selectedTicketIds.size === 0) return;

    const ids = [...selectedTicketIds];
    setBulkDeletingTickets(true);
    setMessage("");
    setError("");

    try {
      const response = await supportService.deleteTickets(ids);
      const deletedIds = Array.isArray(response?.ids) ? response.ids : ids;
      const deletedSet = new Set(deletedIds);
      setTickets((current) => current.filter((item) => !deletedSet.has(item.id)));
      setSelectedTicketIds(new Set());
      setPendingBulkDelete(false);
      setMessage(`${response?.deleted ?? deletedIds.length} ticket(s) supprimé(s).`);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Impossible de supprimer les tickets sélectionnés."));
    } finally {
      setBulkDeletingTickets(false);
    }
  };

  const selectUrgent = () => setFilters((current) => ({ ...current, priority: isInternalPortal ? "urgent" : "high" }));
  const selectOpen = () => setFilters((current) => ({ ...current, status: "open" }));

  return (
    <DashboardLayout
      title={isInternalPortal ? "Support & accompagnement" : "Mes demandes support"}
      subtitle={
        isInternalPortal
          ? "Centralisez les demandes, suivez les tickets et facilitez l’accompagnement des équipes et clients."
          : "Créez une demande, suivez son avancement et consultez les réponses de l’équipe MAPGEO."
      }
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Support
            </nav>

            <p className="mt-2 max-w-2xl text-sm text-mapgeo-secondary/70 lg:hidden">
              {isInternalPortal
                ? "Centralisez les demandes, suivez les tickets et facilitez l’accompagnement des équipes et clients."
                : "Créez une demande, suivez son avancement et consultez les réponses de l’équipe MAPGEO."}
            </p>
          </div>

          <a
            href="#new-ticket"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary"
          >
            <Plus size={18} /> Nouvelle demande
          </a>
        </section>

        <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
          <KpiCard
            icon={Ticket}
            label={isInternalPortal ? "Tickets ouverts" : "Demandes ouvertes"}
            value={formatNumber(metrics.open)}
            description={isInternalPortal ? "Sur la liste filtrée" : "Sur la liste filtrée"}
            action={isInternalPortal ? "Voir les tickets ouverts" : "Voir mes demandes ouvertes"}
            onClick={() => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, status: "open" })}
            tone="blue"
          />

          <KpiCard
            icon={Clock3}
            label="En cours"
            value={formatNumber(metrics.inProgress)}
            description={isInternalPortal ? "Sur la liste filtrée" : "Sur la liste filtrée"}
            action="Voir les demandes en cours"
            onClick={() => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, status: "in_progress" })}
            tone="amber"
          />

          <KpiCard
            icon={AlertTriangle}
            label={isInternalPortal ? "Urgents" : "Priorité haute"}
            value={formatNumber(isInternalPortal ? metrics.urgent : metrics.high)}
            description={isInternalPortal ? "Sur la liste filtrée" : "Sur la liste filtrée"}
            action={isInternalPortal ? "Voir les tickets urgents" : "Voir mes demandes importantes"}
            onClick={() => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, priority: isInternalPortal ? "urgent" : "high" })}
            tone="red"
          />

          <KpiCard
            icon={CheckCircle2}
            label="Résolus / clôturés"
            value={formatNumber(metrics.resolved)}
            description={isInternalPortal ? "Sur la liste filtrée" : "Sur la liste filtrée"}
            action={isInternalPortal ? "Voir les tickets résolus / clôturés" : "Voir mes demandes traitées"}
            onClick={() => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, status: "resolved_or_closed" })}
            tone="green"
          />
        </section>

        <FilterBar filters={filters} setFilters={setFilters} onReset={resetFilters} isInternalPortal={isInternalPortal} clients={clients} parcels={ticketParcelOptions} />

        {message ? (
          <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 px-4 py-3 text-sm font-medium text-mapgeo-primary">
            {message}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <TicketsTable
              tickets={filteredTickets}
              loading={loading}
              error={error}
              onClose={requestCloseTicket}
              onDelete={requestDeleteTicket}
              isInternalPortal={isInternalPortal}
              canManageSupport={canManageSupport}
              selectedIds={selectedTicketIds}
              deletingTicketId={deletingTicketId}
              bulkDeleting={bulkDeletingTickets}
              onToggleSelected={toggleSelectedTicket}
              onToggleVisibleSelection={toggleVisibleTickets}
              onDeleteSelected={requestDeleteSelectedTickets}
            />

            <TicketForm
              form={form}
              setForm={setForm}
              clients={
                clients.length
                  ? clients
                      .map((client) => ({
                        id: clientAccountValue(client),
                        name: clientAccountLabel(client),
                      }))
                      .filter((client) => client.id)
                  : []
              }
              parcels={formParcelOptions}
              parcelQuery={formParcelQuery}
              setParcelQuery={setFormParcelQuery}
              parcelLoading={formParcelsLoading}
              parcelError={formParcelsError}
              submitting={submitting}
              onSubmit={handleCreateTicket}
              onCancel={() => {
                setForm(EMPTY_TICKET_FORM);
                setAttachmentError("");
                setMessage("");
                setError("");
              }}
              isInternalPortal={isInternalPortal}
              attachmentError={attachmentError}
              onAttachmentChange={handleAttachmentChange}
            />
          </div>

          <SupportSummary
            metrics={metrics}
            user={user}
            onShowUrgent={selectUrgent}
            onShowOpen={selectOpen}
            isInternalPortal={isInternalPortal}
          />
        </section>

        {ticketToClose ? (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-mapgeo-primary/40 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel">
              <h3 className="text-xl font-extrabold text-mapgeo-primary">Clôturer le ticket</h3>
              <p className="mt-3 text-sm leading-6 text-mapgeo-secondary">
                Confirmez la clôture du ticket <span className="font-bold text-mapgeo-primary">{ticketToClose.reference}</span>
                {ticketToClose.subject ? ` — ${ticketToClose.subject}` : ""}. Le client sera notifié du changement de statut.
              </p>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setTicketToClose(null)}
                  disabled={Boolean(closingTicketId)}
                  className="inline-flex items-center justify-center rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmCloseTicket}
                  disabled={Boolean(closingTicketId)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCircle2 size={17} /> {closingTicketId ? "Clôture…" : "Clôturer"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {ticketToDelete ? (
          <TicketDeleteDialog
            ticket={ticketToDelete}
            loading={Boolean(deletingTicketId)}
            onCancel={() => (deletingTicketId ? null : setTicketToDelete(null))}
            onConfirm={confirmDeleteTicket}
          />
        ) : null}

        {pendingBulkDelete ? (
          <TicketDeleteDialog
            ticketCount={selectedTicketIds.size}
            loading={bulkDeletingTickets}
            onCancel={() => (bulkDeletingTickets ? null : setPendingBulkDelete(false))}
            onConfirm={confirmDeleteSelectedTickets}
          />
        ) : null}
      </div>
    </DashboardLayout>
  );
}
