import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileCheck2,
  FilePenLine,
  FileText,
  FileUp,
  LayoutList,
  Map as MapIcon,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import documentService from "../services/documentService";
import useParcelSearch, { formatParcelOptionLabel } from "../hooks/useParcelSearch";
import useAuth from "../hooks/useAuth";
import { getErrorMessage } from "../services/responseUtils";
import { canManageBackoffice } from "../constants/roleConstants";
import { formatDateLabel, formatDateTimeLabel } from "../utils/dateUtils";
import { ACCEPTED_DOCUMENT_ACCEPT, ACCEPTED_DOCUMENT_FORMATS_LABEL, DOCUMENT_STATUS_OPTIONS, DOCUMENT_TYPE_OPTIONS, MAX_DOCUMENT_SIZE_LABEL, canDocumentBePublic, getDocumentVisibilityClasses, getDocumentVisibilityLabel, isDocumentVisibleToClient, validateDocumentFile } from "../constants/documentConstants";


const EMPTY_UPLOAD_FORM = {
  title: "",
  parcel: "",
  document_type: "plan_pdf",
  version: "v1",
  status: "draft",
  description: "",
  is_public_for_client: false,
  file: null,
};

const EMPTY_FILTERS = {
  q: "",
  document_type: "",
  status: "",
  organization_code: "",
  parcel: "",
  visibility: "",
};

function labelFromOptions(options, value, fallback = "—") {
  return options.find(([optionValue]) => optionValue === value)?.[1] || value || fallback;
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function formatDate(value, fallback = "—") {
  return formatDateLabel(value, fallback, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value, fallback = "—") {
  return formatDateTimeLabel(value, fallback, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}


function formatFileSize(value) {
  const size = Number(value || 0);

  if (!size) return "—";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(size / 1024)} Ko`;

  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} Mo`;
}

function extensionFromTitle(title = "") {
  const extension = String(title).split(".").pop();
  return extension && extension !== title ? extension.toLowerCase() : "doc";
}

function extensionFromDocument(doc, fallbackTitle = "") {
  const rawExtension = doc.extension || doc.file_extension;
  if (rawExtension) return String(rawExtension).replace(/^\./, "").toLowerCase();

  return extensionFromTitle(doc.file_name || doc.original_filename || fallbackTitle);
}

function normalizeDocument(doc, index = 0) {
  const title = doc.title || doc.name || doc.file_name || `Document ${index + 1}`;
  const extension = extensionFromDocument(doc, title);

  return {
    ...doc,
    id: doc.id ?? null,
    title,
    extension,
    file_name: doc.file_name || doc.original_filename || title,
    file_size: doc.file_size ?? doc.size ?? null,
    file_size_label: doc.file_size_label || formatFileSize(doc.file_size ?? doc.size),
    document_type: doc.document_type || doc.type || "other",
    typeLabel: doc.document_type_label || doc.type_label || labelFromOptions(DOCUMENT_TYPE_OPTIONS, doc.document_type || doc.type, "Autre"),
    parcel_reference: doc.parcel_reference || doc.parcel_code || doc.parcel?.reference || doc.parcel || "Sans parcelle",
    parcel_id: doc.parcel_id || doc.parcel?.id || doc.parcel || "",
    client_name: doc.client_name || doc.owner_name || doc.organization_name || doc.parcel?.owner_name || doc.client || "Client non renseigné",
    owner_client_code: doc.owner_client_code || doc.client_code || "",
    organization_code: doc.organization_code || doc.parcel?.organization_code || "",
    organization_name: doc.organization_name || doc.parcel?.organization_name || "",
    version: doc.version || "v1",
    status: doc.status || "draft",
    statusLabel: doc.status_label || labelFromOptions(DOCUMENT_STATUS_OPTIONS, doc.status || "draft", "Brouillon"),
    is_public_for_client: Boolean(doc.is_public_for_client ?? doc.visible_client ?? doc.public ?? false),
    source: doc.source || "internal",
    uploaded_by_name: doc.uploaded_by_name || null,
    created_at: doc.created_at || doc.date || doc.created || null,
    updated_at: doc.updated_at || doc.updated || null,
    created_at_label: doc.created_at_label || formatDate(doc.created_at || doc.date || doc.created),
    accent: ["bg-mapgeo-primary", "bg-mapgeo-primary", "bg-mapgeo-sand", "bg-mapgeo-primary", "bg-mapgeo-primary"][index % 5],
  };
}

function statusClasses(status) {
  const value = String(status || "").toLowerCase();

  if (value.includes("final") || value.includes("valid")) return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (value.includes("draft") || value.includes("brouillon")) return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (value.includes("archiv")) return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/75";

  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary";
}

function visibilityClasses(doc) {
  return getDocumentVisibilityClasses(doc);
}


function FileBadge({ extension }) {
  const value = String(extension || "doc").toUpperCase().slice(0, 4);

  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-mapgeo-primary text-[10px] font-extrabold text-white shadow-sm">
      {value}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, description, action, href, onClick, tone = "blue" }) {
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
        {href ? (
          <Link to={href} className="inline-flex items-center gap-2 text-sm font-bold text-mapgeo-primary transition group-hover:gap-3">
            {action} <ChevronRight size={16} />
          </Link>
        ) : (
          <button type="button" onClick={onClick} className="inline-flex items-center gap-2 text-sm font-bold text-mapgeo-primary transition group-hover:gap-3">
            {action} <ChevronRight size={16} />
          </button>
        )}
      </div>
    </article>
  );
}

function FilterBar({ filters, onChange, onReset, parcels, clients, isInternalPortal }) {
  const update = (name, value) => onChange({ ...filters, [name]: value });

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-4 shadow-soft">
      <div
        className={
          isInternalPortal
            ? "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-[1.35fr_1fr_1fr_1fr_1fr_1fr_auto]"
            : "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-[1.35fr_1fr_1fr_1fr_auto]"
        }
      >
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-mapgeo-primary/80">Recherche</span>
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm focus-within:border-mapgeo-primary/40 focus-within:ring-4 focus-within:ring-mapgeo-primary/5">
            <Search size={16} className="text-mapgeo-secondary/60" />
            <input
              value={filters.q}
              onChange={(event) => update("q", event.target.value)}
              placeholder={isInternalPortal ? "Titre, parcelle, client..." : "Titre, parcelle..."}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
            />
          </div>
        </label>

        <SelectField label="Type document" icon={FileText} value={filters.document_type} onChange={(value) => update("document_type", value)}>
          <option value="">Tous les types</option>
          {DOCUMENT_TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectField>

        <SelectField label="Statut" icon={ShieldCheck} value={filters.status} onChange={(value) => update("status", value)}>
          <option value="">Tous les statuts</option>
          {DOCUMENT_STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectField>

        {isInternalPortal ? (
          <SelectField label="Client" icon={UsersRound} value={filters.organization_code} onChange={(value) => update("organization_code", value)}>
            <option value="">Tous les clients</option>
            {clients.map((client) => (
              <option key={client.value} value={client.value}>{client.label}</option>
            ))}
          </SelectField>
        ) : null}

        <SelectField label="Parcelle" icon={LayoutList} value={filters.parcel} onChange={(value) => update("parcel", value)}>
          <option value="">Toutes les parcelles</option>
          {parcels.map((parcel) => (
            <option key={parcel.id || parcel.reference} value={parcel.reference || parcel.id}>
              {parcel.reference || parcel.title_number || parcel.id}
            </option>
          ))}
        </SelectField>

        {isInternalPortal ? (
          <SelectField label="Visibilité client" icon={UsersRound} value={filters.visibility} onChange={(value) => update("visibility", value)}>
            <option value="">Toutes</option>
            <option value="client">Visible client</option>
            <option value="internal">Interne</option>
          </SelectField>
        ) : null}

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

function DocumentsTable({
  documents,
  loading,
  error,
  canManage,
  documentAction,
  isInternalPortal,
  deletingId,
  selectedIds,
  bulkDeleting,
  onToggleSelected,
  onToggleVisibleSelection,
  onDeleteSelected,
  onDownload,
  onReplace,
  onArchive,
  onDelete,
  onShowAll,
  syncLabel,
  returnTo = "/documents",
}) {
  const selectableDocuments = canManage ? documents.filter((doc) => doc.id) : [];
  const selectedCount = selectedIds?.size || 0;
  const visibleSelected = selectableDocuments.filter((doc) => selectedIds?.has(doc.id)).length;
  const allVisibleSelected = selectableDocuments.length > 0 && visibleSelected === selectableDocuments.length;

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-mapgeo-line p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">
            {isInternalPortal ? "Liste des documents" : "Mes documents"}
          </h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">
            {isInternalPortal
              ? "Vue liste des livrables, versions, statuts et visibilités client."
              : "Consultez les documents disponibles pour vos parcelles."}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canManage ? (
            <>
              <label className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-extrabold text-mapgeo-primary shadow-sm">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={!selectableDocuments.length || bulkDeleting}
                  onChange={() => onToggleVisibleSelection(selectableDocuments, !allVisibleSelected)}
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
            Dernière synchronisation : {syncLabel}
            <RefreshCcw size={15} className="text-mapgeo-primary" />
          </div>
        </div>
      </div>

      {loading ? <div className="p-6 text-sm text-mapgeo-secondary">Chargement des documents…</div> : null}

      {error ? (
        <div className="m-6 rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm font-medium text-mapgeo-primary">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="overflow-x-auto">
          <table className={isInternalPortal ? "min-w-[1120px] w-full text-left text-sm" : "min-w-[920px] w-full text-left text-sm"}>
            <thead>
              <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
                {canManage ? <th className="w-12 px-5 py-4" aria-label="Sélection" /> : null}
                <th className="px-5 py-4">Document</th>
                <th className="px-4 py-4">Parcelle</th>
                <th className="px-4 py-4">Type</th>
                {isInternalPortal ? <th className="px-4 py-4">Client</th> : null}
                <th className="px-4 py-4">Version</th>
                <th className="px-4 py-4">Statut</th>
                {isInternalPortal ? <th className="px-4 py-4">Visibilité</th> : null}
                <th className="px-4 py-4">Date d’ajout</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-mapgeo-line">
              {documents.length === 0 ? (
                <tr>
                  <td colSpan={(isInternalPortal ? 9 : 7) + (canManage ? 1 : 0)} className="px-5 py-10 text-center text-mapgeo-secondary">
                    Aucun document disponible.
                  </td>
                </tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id} className="transition hover:bg-mapgeo-ivory/40">
                    {canManage ? (
                      <td className="px-5 py-4">
                        <label className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-mapgeo-line bg-white shadow-sm">
                          <input
                            type="checkbox"
                            checked={selectedIds?.has(doc.id) || false}
                            disabled={!doc.id || bulkDeleting || deletingId === doc.id}
                            onChange={() => onToggleSelected(doc.id)}
                            aria-label={`Sélectionner ${doc.title}`}
                          />
                        </label>
                      </td>
                    ) : null}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <FileBadge extension={doc.extension} />
                        <span>
                          <span className="block font-extrabold text-mapgeo-primary">{doc.title}</span>
                          <span className="block text-xs font-medium text-mapgeo-secondary/65">{doc.file_size_label}</span>
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-4 font-semibold text-mapgeo-primary">
                      {doc.parcel_id ? (
                        <Link
                          to={`/parcelles/${doc.parcel_id}/carto`}
                          state={{ returnTo }}
                          className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-mapgeo-primary hover:bg-mapgeo-ivory"
                        >
                          <MapIcon size={14} /> {doc.parcel_reference}
                        </Link>
                      ) : (
                        doc.parcel_reference
                      )}
                    </td>
                    <td className="px-4 py-4 text-mapgeo-secondary">{doc.typeLabel}</td>

                    {isInternalPortal ? (
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 items-center justify-center rounded-full ${doc.accent} text-xs font-extrabold text-white`}>
                            {doc.client_name?.[0] || "C"}
                          </span>
                          <span className="font-semibold text-mapgeo-primary">{doc.client_name}</span>
                        </div>
                      </td>
                    ) : null}

                    <td className="px-4 py-4 font-semibold text-mapgeo-primary">{doc.version}</td>

                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${statusClasses(doc.status)}`}>
                        {doc.statusLabel}
                      </span>
                    </td>

                    {isInternalPortal ? (
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${visibilityClasses(doc)}`}>
                          {getDocumentVisibilityLabel(doc)}
                        </span>
                      </td>
                    ) : null}

                    <td className="px-4 py-4 text-mapgeo-secondary">{doc.created_at_label}</td>

                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <ActionIcon
                          label={documentAction === `${doc.id}:download` ? "Téléchargement sécurisé…" : "Téléchargement sécurisé"}
                          onClick={() => onDownload(doc)}
                          icon={documentAction === `${doc.id}:download` ? RefreshCcw : Download}
                          disabled={documentAction === `${doc.id}:download` || deletingId === doc.id}
                        />

                        <Link
                          to={`/documents/${doc.id}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-mapgeo-line bg-white text-mapgeo-primary transition hover:bg-mapgeo-ivory"
                          title="Prévisualiser"
                          aria-label="Prévisualiser"
                        >
                          <Eye size={16} />
                        </Link>

                        {canManage ? <ActionIcon label="Remplacer" onClick={() => onReplace(doc)} icon={RotateCcw} /> : null}
                        {canManage ? <ActionIcon label="Archiver" onClick={() => onArchive(doc)} icon={Archive} /> : null}

                        {canManage ? (
                          <button
                            type="button"
                            disabled={deletingId === doc.id || bulkDeleting}
                            onClick={() => onDelete(doc)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-mapgeo-line bg-white text-mapgeo-primary transition hover:bg-mapgeo-sand/10 disabled:opacity-60"
                            title="Supprimer"
                            aria-label="Supprimer"
                          >
                            <Trash2 size={16} />
                          </button>
                        ) : null}
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
          <button type="button" onClick={onShowAll} className="inline-flex items-center gap-2 text-sm font-extrabold text-mapgeo-primary transition hover:gap-3">
            {isInternalPortal ? "Voir tous les documents" : "Voir tous mes documents"} <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ActionIcon({ label, onClick, icon: Icon, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-mapgeo-line bg-white text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50"
      title={label}
      aria-label={label}
    >
      <Icon size={16} />
    </button>
  );
}

function ConfirmDialog({ documentTitle, documentCount = 1, loading, onCancel, onConfirm }) {
  const isBulk = documentCount > 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-mapgeo-primary/35 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirmation de suppression">
      <div className="w-full max-w-md rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mapgeo-secondary/70">Confirmation</p>
        <h3 className="mt-2 text-2xl font-extrabold text-mapgeo-primary">{isBulk ? "Supprimer les documents sélectionnés ?" : "Supprimer ce document ?"}</h3>
        <p className="mt-3 text-sm leading-6 text-mapgeo-secondary/80">
          {isBulk
            ? `${documentCount} document(s) seront supprimé(s) de la bibliothèque. Cette action est définitive.`
            : `Le document « ${documentTitle || "Document"} » sera supprimé de la bibliothèque. Cette action est définitive.`}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} disabled={loading} className="rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-50">
            {loading ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocumentSummary({ documents, onSelectAlert, isInternalPortal, lastAddedLabel }) {
  const total = documents.length;
  const finalCount = documents.filter((doc) => doc.status === "final").length;
  const draftCount = documents.filter((doc) => doc.status === "draft").length;
  const coveredParcels = new Set(documents.map((doc) => doc.parcel_reference).filter(Boolean)).size;

  const alerts = [
    { label: "Documents en brouillon", color: "bg-mapgeo-sand", filter: { status: "draft" } },
    { label: "Documents validés", color: "bg-mapgeo-sand", filter: { status: "validated" } },
    { label: "Documents finaux", color: "bg-mapgeo-sand", filter: { status: "final" } },
    { label: "Documents archivés", color: "bg-mapgeo-sand", filter: { status: "archived" } },
  ];

  return (
    <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl" />

      <div className="relative">
        <h3 className="text-sm font-extrabold text-white">
          {isInternalPortal ? "Résumé documentaire" : "Résumé de mes documents"}
        </h3>

        <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
          <SummaryMetric icon={FileText} label="Documents disponibles" value={formatNumber(total)} />
          <SummaryMetric icon={CheckCircle2} label="Documents finaux" value={formatNumber(finalCount)} />
          {isInternalPortal ? <SummaryMetric icon={FilePenLine} label="Brouillons" value={formatNumber(draftCount)} /> : null}
          <SummaryMetric icon={LayoutList} label="Parcelles couvertes" value={formatNumber(coveredParcels)} />
          <SummaryMetric icon={CalendarDays} label="Dernier ajout" value={lastAddedLabel} />
        </div>

        {isInternalPortal ? (
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
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-1">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Portail</p>
            <p className="mt-1 font-extrabold">{isInternalPortal ? "Interne" : "Client"}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Accès</p>
            <p className="mt-1 font-extrabold">{isInternalPortal ? "Gestion documentaire" : "Consultation"}</p>
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

function UploadPanel({ form, parcels, parcelQuery, setParcelQuery, parcelLoading, parcelError, onChange, onSubmit, uploading, message, canUpload, canManage, isInternalPortal }) {
  const publicVisibilityDisabled = !canDocumentBePublic(form.status);

  return (
    <section id="ajout-document" className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div>
        <h3 className="text-xl font-extrabold text-mapgeo-primary">{isInternalPortal ? "Ajout / upload document" : "Transmettre un document"}</h3>
        <p className="mt-1 text-sm text-mapgeo-secondary/70">
          {isInternalPortal ? "Ajoutez un livrable et rattachez-le à une parcelle." : "Déposez une pièce sur l’une de vos parcelles. Elle restera privée jusqu’au traitement MAPGEO."}
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <TextInput label="Titre" name="title" value={form.title} onChange={onChange} placeholder="Ex. Plan de bornage" required />

        <label className="block">
          <span className="text-xs font-bold text-mapgeo-primary">Parcelle liée *</span>
          <input
            value={parcelQuery}
            onChange={(event) => setParcelQuery(event.target.value)}
            placeholder="Rechercher par référence, client ou commune"
            className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none"
          />

          <div className="mt-1 min-h-[1.25rem] text-xs text-mapgeo-secondary/70">
            {parcelLoading ? "Recherche des parcelles…" : null}
            {!parcelLoading && parcelError ? <span className="text-red-600">{parcelError}</span> : null}
            {!parcelLoading && !parcelError && parcels.length ? `${parcels.length} parcelle(s) proposée(s)` : null}
          </div>

          <select
            name="parcel"
            value={form.parcel}
            onChange={onChange}
            className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none"
            required
          >
            <option value="">Sélectionner une parcelle</option>
            {parcels.map((parcel) => (
              <option key={parcel.id} value={parcel.id}>
                {formatParcelOptionLabel(parcel)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectInput label="Type" name="document_type" value={form.document_type} onChange={onChange} options={DOCUMENT_TYPE_OPTIONS} />
          <TextInput label="Version" name="version" value={form.version} onChange={onChange} placeholder="v1" />

          {canManage ? (
            <>
              <SelectInput label="Statut" name="status" value={form.status} onChange={onChange} options={DOCUMENT_STATUS_OPTIONS} />

              <label className="flex items-center justify-between gap-3 rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm font-semibold text-mapgeo-primary">
                <span>
                  Visible client
                  {publicVisibilityDisabled ? (
                    <em className="block text-[10px] font-medium not-italic text-mapgeo-secondary/65">Uniquement validé ou final</em>
                  ) : null}
                </span>
                <input
                  type="checkbox"
                  name="is_public_for_client"
                  checked={form.is_public_for_client}
                  onChange={onChange}
                  disabled={publicVisibilityDisabled}
                  className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-45"
                />
              </label>
            </>
          ) : (
            <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory px-3 py-2.5 text-sm font-semibold text-mapgeo-primary sm:col-span-2">
              Dépôt client privé · validation MAPGEO requise avant publication.
            </div>
          )}
        </div>

        <label className="block">
          <span className="text-xs font-bold text-mapgeo-primary">Description</span>
          <textarea
            name="description"
            value={form.description}
            onChange={onChange}
            rows={3}
            placeholder="Description optionnelle du document..."
            className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none"
          />
        </label>

        <label className="flex min-h-[130px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-mapgeo-sand/60 bg-mapgeo-sand/15 px-4 py-5 text-center transition hover:bg-mapgeo-sand/15">
          <Upload size={28} className="text-mapgeo-primary" />
          <span className="mt-2 text-sm font-semibold text-mapgeo-primary">
            {form.file ? form.file.name : "Glissez-déposez votre fichier ici"}
          </span>
          <span className="text-xs text-mapgeo-secondary/70">ou cliquez pour parcourir · Taille max : {MAX_DOCUMENT_SIZE_LABEL}</span>
          <input
            type="file"
            name="file"
            className="hidden"
            onChange={onChange}
            accept={ACCEPTED_DOCUMENT_ACCEPT}
            disabled={uploading || !canUpload}
          />
        </label>

        <div className="space-y-2 text-sm text-mapgeo-secondary/80">
          <Hint>Formats acceptés : {ACCEPTED_DOCUMENT_FORMATS_LABEL}</Hint>
          <Hint>{canManage ? "Versioning pris en charge" : "Visible uniquement par vous et l’équipe MAPGEO"}</Hint>
          <Hint>{canManage ? "Historique des documents" : "Notification automatique de l’équipe MAPGEO"}</Hint>
        </div>

        {message ? <p className="rounded-2xl bg-mapgeo-ivory px-3 py-2 text-sm text-mapgeo-secondary">{message}</p> : null}

        <button
          type="submit"
          disabled={uploading || !canUpload}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileUp size={17} /> {uploading ? "Envoi en cours..." : (canManage ? "Ajouter le document" : "Transmettre le document")}
        </button>
      </form>
    </section>
  );
}

function TextInput({ label, name, value, onChange, placeholder, required = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-mapgeo-primary">{label}{required ? " *" : ""}</span>
      <input
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none focus:border-mapgeo-accent"
        required={required}
      />
    </label>
  );
}

function SelectInput({ label, name, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-mapgeo-primary">{label} *</span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="mt-2 w-full rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 text-sm outline-none focus:border-mapgeo-accent"
      >
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function Hint({ children }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 size={15} className="text-mapgeo-primary" />
      <span>{children}</span>
    </div>
  );
}

export default function DocumentsPage() {
  const { user, isInternalPortal } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentReturnTo = `${location.pathname}${location.search || ""}`;
  const canManageDocuments = canManageBackoffice(user, isInternalPortal);
  const canUploadDocuments = canManageDocuments || !isInternalPortal;
  const replaceInputRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    q: searchParams.get("q") || "",
    organization_code: searchParams.get("organization_code") || searchParams.get("client") || "",
    status: searchParams.get("status") || "",
    document_type: searchParams.get("document_type") || "",
  }));
  const [uploadForm, setUploadForm] = useState(EMPTY_UPLOAD_FORM);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState(new Set());
  const [documentAction, setDocumentAction] = useState(null);
  const [replacingDocument, setReplacingDocument] = useState(null);
  const [pendingDeleteDocument, setPendingDeleteDocument] = useState(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const {
    parcels: uploadParcelOptions,
    loading: parcelOptionsLoading,
    error: parcelOptionsError,
    query: parcelQuery,
    setQuery: setParcelQuery,
    refresh: refreshParcelOptions,
  } = useParcelSearch({
    selectedParcelId: uploadForm.parcel,
    pageSize: 50,
    debounceMs: 300,
  });

  const normalizedDocuments = useMemo(() => documents.map(normalizeDocument), [documents]);

  const filteredDocuments = useMemo(() => {
    return normalizedDocuments.filter((doc) => {
      const q = filters.q.trim().toLowerCase();

      const matchesSearch =
        !q ||
        [doc.title, doc.typeLabel, doc.parcel_reference, doc.client_name, doc.owner_client_code, doc.organization_name, doc.organization_code, doc.version, doc.file_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));

      const matchesType = !filters.document_type || doc.document_type === filters.document_type;
      const matchesStatus = !filters.status || doc.status === filters.status;
      const matchesClient = !isInternalPortal || !filters.organization_code || [doc.organization_code, doc.owner_client_code].filter(Boolean).includes(filters.organization_code);
      const matchesParcel = !filters.parcel || doc.parcel_reference === filters.parcel || String(doc.parcel_id) === filters.parcel;
      const matchesVisibility =
        !isInternalPortal ||
        !filters.visibility ||
        (filters.visibility === "client" && isDocumentVisibleToClient(doc)) ||
        (filters.visibility === "internal" && !isDocumentVisibleToClient(doc));

      return matchesSearch && matchesType && matchesStatus && matchesClient && matchesParcel && matchesVisibility;
    });
  }, [filters, normalizedDocuments, isInternalPortal]);

  const clientOptions = useMemo(() => {
    const byCode = new Map();
    normalizedDocuments.forEach((doc) => {
      const code = String(doc.organization_code || doc.owner_client_code || "").trim();
      if (!code || byCode.has(code)) return;
      const name = String(doc.organization_name || doc.client_name || "").trim();
      byCode.set(code, { value: code, label: name ? `${name} · ${code}` : code });
    });
    return Array.from(byCode.values()).sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
  }, [normalizedDocuments]);

  const documentParcelOptions = useMemo(() => {
    const byReference = new Map();
    normalizedDocuments.forEach((doc) => {
      const reference = doc.parcel_reference;
      if (!reference || reference === "Sans parcelle") return;
      if (!byReference.has(reference)) {
        byReference.set(reference, {
          id: doc.parcel_id || reference,
          reference,
          owner_name: doc.client_name,
        });
      }
    });
    return Array.from(byReference.values()).sort((a, b) => String(a.reference).localeCompare(String(b.reference), "fr", { numeric: true }));
  }, [normalizedDocuments]);

  const kpis = useMemo(() => {
    const total = filteredDocuments.length;
    const drafts = filteredDocuments.filter((doc) => doc.status === "draft").length;
    const finals = filteredDocuments.filter((doc) => doc.status === "final").length;
    const visible = filteredDocuments.filter((doc) => isDocumentVisibleToClient(doc)).length;

    if (!isInternalPortal) {
      return [
        {
          icon: FileText,
          label: "Mes documents",
          value: formatNumber(total),
          description: "Sur la liste filtrée",
          action: "Voir mes documents",
          onClick: () => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code }),
          tone: "blue",
        },
        {
          icon: FileCheck2,
          label: "Documents finaux",
          value: formatNumber(finals),
          description: "Sur la liste filtrée",
          action: "Voir les documents finaux",
          onClick: () => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, status: "final" }),
          tone: "green",
        },
        {
          icon: LayoutList,
          label: "Parcelles couvertes",
          value: formatNumber(new Set(filteredDocuments.map((doc) => doc.parcel_reference).filter(Boolean)).size),
          description: "Sur la liste filtrée",
          action: "Voir les parcelles",
          href: "/parcelles",
          tone: "purple",
        },
      ];
    }

    return [
      {
        icon: FileText,
        label: "Documents disponibles",
        value: formatNumber(total),
        description: "Sur la liste filtrée",
        action: "Voir les documents",
        onClick: () => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code }),
        tone: "blue",
      },
      {
        icon: FilePenLine,
        label: "Brouillons",
        value: formatNumber(drafts),
        description: "Sur la liste filtrée",
        action: "Voir les brouillons",
        onClick: () => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, status: "draft" }),
        tone: "purple",
      },
      {
        icon: FileCheck2,
        label: "Documents finaux",
        value: formatNumber(finals),
        description: "Sur la liste filtrée",
        action: "Voir les documents finaux",
        onClick: () => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, status: "final" }),
        tone: "green",
      },
      {
        icon: UsersRound,
        label: "Documents visibles client",
        value: formatNumber(visible),
        description: "Sur la liste filtrée",
        action: "Voir la visibilité",
        onClick: () => setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, visibility: "client" }),
        tone: "orange",
      },
    ];
  }, [filters.organization_code, filteredDocuments, isInternalPortal]);

  const loadDocuments = async (params = {}) => {
    setLoading(true);
    setError("");

    try {
      const data = await documentService.getAllDocuments({
        ...(params.q ? { q: params.q } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.document_type ? { document_type: params.document_type } : {}),
      });

      setDocuments(data.results || []);
      setLastSyncAt(new Date().toISOString());
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err, "Impossible de charger les documents."));
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const existingIds = new Set(documents.map((doc) => doc.id).filter(Boolean));
    setSelectedDocumentIds((current) => {
      const next = new Set([...current].filter((id) => existingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [documents]);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (filters.q) nextParams.set("q", filters.q);
    if (filters.organization_code) nextParams.set("organization_code", filters.organization_code);
    if (filters.status) nextParams.set("status", filters.status);
    if (filters.document_type) nextParams.set("document_type", filters.document_type);
    setSearchParams(nextParams, { replace: true });
  }, [filters.document_type, filters.organization_code, filters.q, filters.status, setSearchParams]);

  const handleUploadChange = (event) => {
    const { name, value, type, checked, files } = event.target;

    if (files) {
      const file = files[0] || null;
      const validationMessage = file ? validateDocumentFile(file) : "";

      if (validationMessage) {
        setMessage(validationMessage);
        event.target.value = "";
        return;
      }

      setMessage("");
      setUploadForm((current) => ({ ...current, [name]: file }));
      return;
    }

    setUploadForm((current) => {
      if (name === "status") {
        return {
          ...current,
          status: value,
          is_public_for_client: canDocumentBePublic(value) ? current.is_public_for_client : false,
        };
      }

      if (name === "is_public_for_client") {
        return {
          ...current,
          is_public_for_client: canDocumentBePublic(current.status) ? checked : false,
        };
      }

      return {
        ...current,
        [name]: type === "checkbox" ? checked : value,
      };
    });
  };

  const handleUploadSubmit = async (event) => {
    event.preventDefault();

    if (!canUploadDocuments) {
      setMessage("Vous ne pouvez pas ajouter de document avec ce compte.");
      return;
    }

    const normalizedTitle = uploadForm.title.trim();
    const normalizedVersion = uploadForm.version.trim() || "v1";
    const normalizedDescription = uploadForm.description.trim();

    if (!normalizedTitle) {
      setMessage("Renseignez un titre de document.");
      return;
    }

    if (!uploadForm.parcel) {
      setMessage("Sélectionnez une parcelle avant l’envoi.");
      return;
    }

    if (!uploadForm.file) {
      setMessage("Sélectionnez un fichier avant l’envoi.");
      return;
    }

    const fileValidationMessage = validateDocumentFile(uploadForm.file);

    if (fileValidationMessage) {
      setMessage(fileValidationMessage);
      return;
    }

    if (isInternalPortal && uploadForm.is_public_for_client && !canDocumentBePublic(uploadForm.status)) {
      setMessage("Un document brouillon ou archivé ne peut pas être visible côté client.");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("title", normalizedTitle);
      formData.append("parcel", uploadForm.parcel);
      const effectiveStatus = isInternalPortal ? uploadForm.status : "draft";
      const effectivePublicVisibility = isInternalPortal && canDocumentBePublic(effectiveStatus)
        ? uploadForm.is_public_for_client
        : false;

      formData.append("document_type", uploadForm.document_type);
      formData.append("version", normalizedVersion);
      formData.append("status", effectiveStatus);
      formData.append("description", normalizedDescription);
      formData.append("is_public_for_client", String(effectivePublicVisibility));
      formData.append("file", uploadForm.file);

      await documentService.createDocument(formData);
      setUploadForm(EMPTY_UPLOAD_FORM);
      setParcelQuery("");
      refreshParcelOptions();
      setMessage(
        isInternalPortal
          ? "Document ajouté avec succès. Le téléchargement restera sécurisé via l’API."
          : "Document transmis avec succès. Il restera privé jusqu’au traitement par l’équipe MAPGEO."
      );
      await loadDocuments(filters);
    } catch (uploadError) {
      setMessage(getErrorMessage(uploadError, "Impossible d’ajouter ce document."));
    } finally {
      setUploading(false);
    }
  };

  const openBlob = async (doc, { download = false } = {}) => {
    if (!doc.id) {
      setMessage("Impossible d’ouvrir ce document : identifiant manquant.");
      return;
    }

    const actionKey = `${doc.id}:${download ? "download" : "preview"}`;
    setDocumentAction(actionKey);
    setMessage("");

    try {
      const blob = await documentService.downloadDocument(doc.id);
      const blobUrl = URL.createObjectURL(blob);

      if (download) {
        const link = globalThis.document.createElement("a");
        link.href = blobUrl;
        link.download = doc.file_name || doc.title || "document";
        globalThis.document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
        setMessage("Téléchargement sécurisé lancé.");
        return;
      }

      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      setMessage("Aperçu sécurisé ouvert dans un nouvel onglet.");
    } finally {
      setDocumentAction(null);
    }
  };

  const toggleSelectedDocument = (id) => {
    if (!id || !canManageDocuments) return;
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleDocuments = (items, shouldSelect) => {
    if (!canManageDocuments) return;
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      items.forEach((item) => {
        if (!item.id) return;
        if (shouldSelect) next.add(item.id);
        else next.delete(item.id);
      });
      return next;
    });
  };

  const requestDeleteSelectedDocuments = () => {
    if (!canManageDocuments || selectedDocumentIds.size === 0) return;
    setPendingBulkDelete(true);
  };

  const handleDelete = (doc) => {
    if (!canManageDocuments) return;

    if (!doc.id) {
      setMessage("Impossible de supprimer ce document : identifiant manquant.");
      return;
    }

    setPendingDeleteDocument(doc);
  };

  const executeDelete = async () => {
    if (!pendingDeleteDocument?.id || !canManageDocuments) return;

    setDeletingId(pendingDeleteDocument.id);
    setMessage("");

    try {
      await documentService.deleteDocument(pendingDeleteDocument.id);
      setDocuments((current) => current.filter((item) => item.id !== pendingDeleteDocument.id));
      setSelectedDocumentIds((current) => {
        const next = new Set(current);
        next.delete(pendingDeleteDocument.id);
        return next;
      });
      setMessage("Document supprimé.");
      setPendingDeleteDocument(null);
    } catch (deleteError) {
      setMessage(getErrorMessage(deleteError, "Impossible de supprimer ce document."));
    } finally {
      setDeletingId(null);
    }
  };

  const executeBulkDelete = async () => {
    if (!canManageDocuments || selectedDocumentIds.size === 0) return;

    const ids = [...selectedDocumentIds];
    setBulkDeleting(true);
    setMessage("");

    try {
      const response = await documentService.deleteDocuments(ids);
      const deletedIds = Array.isArray(response?.ids) ? response.ids : ids;
      const deletedSet = new Set(deletedIds);
      setDocuments((current) => current.filter((item) => !deletedSet.has(item.id)));
      setSelectedDocumentIds(new Set());
      setPendingBulkDelete(false);
      setMessage(`${response?.deleted ?? deletedIds.length} document(s) supprimé(s).`);
    } catch (deleteError) {
      setMessage(getErrorMessage(deleteError, "Impossible de supprimer les documents sélectionnés."));
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleArchive = async (doc) => {
    if (!canManageDocuments) return;

    if (!doc.id) {
      setMessage("Impossible d’archiver ce document : identifiant manquant.");
      return;
    }

    try {
      await documentService.updateDocument(doc.id, { status: "archived" });
      setMessage("Document archivé.");
      await loadDocuments(filters);
    } catch (archiveError) {
      setMessage(getErrorMessage(archiveError, "Archivage impossible."));
    }
  };

  const handleReplace = (doc) => {
    if (!canManageDocuments) return;
    setReplacingDocument(doc);
    replaceInputRef.current?.click();
  };

  const handleReplaceFile = async (event) => {
    const file = event.target.files?.[0];

    if (!file || !replacingDocument || !canManageDocuments) return;

    const validationMessage = validateDocumentFile(file);

    if (validationMessage) {
      setMessage(validationMessage);
      event.target.value = "";
      setReplacingDocument(null);
      return;
    }

    if (!replacingDocument.id) {
      setMessage("Impossible de remplacer ce document : identifiant manquant.");
      event.target.value = "";
      setReplacingDocument(null);
      return;
    }

    if (!replacingDocument.parcel_id) {
      setMessage("Impossible de remplacer ce document sans parcelle liée.");
      event.target.value = "";
      setReplacingDocument(null);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("title", replacingDocument.title);
      formData.append("parcel", replacingDocument.parcel_id || "");
      formData.append("document_type", replacingDocument.document_type);
      formData.append("version", replacingDocument.version || "v1");
      const replacementStatus = replacingDocument.status || "draft";
      formData.append("status", replacementStatus);
      formData.append("is_public_for_client", String(canDocumentBePublic(replacementStatus) ? replacingDocument.is_public_for_client : false));
      formData.append("file", file);

      await documentService.updateDocument(replacingDocument.id, formData);
      setMessage("Document remplacé avec succès.");
      await loadDocuments(filters);
    } catch (replaceError) {
      setMessage(getErrorMessage(replaceError, "Remplacement impossible."));
    } finally {
      event.target.value = "";
      setReplacingDocument(null);
    }
  };

  const showAllDocuments = () => setFilters(EMPTY_FILTERS);

  const selectDocumentAlert = (filter = {}) => {
    setFilters({ ...EMPTY_FILTERS, organization_code: filters.organization_code, ...filter });
  };

  const lastSyncLabel = lastSyncAt ? formatDateTime(lastSyncAt) : "non effectuée";

  const lastAddedLabel = useMemo(() => {
    const dates = normalizedDocuments
      .map((doc) => doc.created_at)
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));

    if (!dates.length) return "—";

    const latest = dates.reduce((current, candidate) => (candidate > current ? candidate : current));
    return formatDate(latest.toISOString());
  }, [normalizedDocuments]);

  return (
    <DashboardLayout
      title={isInternalPortal ? "Bibliothèque documentaire" : "Mes documents"}
      subtitle={
        isInternalPortal
          ? "Centralisez les livrables liés aux parcelles et aux clients dans une bibliothèque claire et structurée."
          : "Consultez les documents disponibles pour vos parcelles."
      }
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Documents
            </nav>

            <p className="mt-2 max-w-2xl text-sm text-mapgeo-secondary/70 lg:hidden">
              {isInternalPortal
                ? "Centralisez les livrables liés aux parcelles et aux clients dans une bibliothèque claire et structurée."
                : "Consultez les documents disponibles pour vos parcelles."}
            </p>
          </div>

          {canUploadDocuments ? (
            <a
              href="#ajout-document"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary"
            >
              <FileUp size={18} /> {isInternalPortal ? "Ajouter un document" : "Transmettre un document"}
            </a>
          ) : null}
        </section>

        <section className={isInternalPortal ? "grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4" : "grid grid-cols-1 gap-5 md:grid-cols-3"}>
          {kpis.map((item) => (
            <KpiCard key={item.label} {...item} />
          ))}
        </section>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(EMPTY_FILTERS)}
          parcels={documentParcelOptions}
          clients={clientOptions}
          isInternalPortal={isInternalPortal}
        />

        {message ? (
          <div className="rounded-2xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-4 py-3 text-sm font-medium text-mapgeo-primary">
            {message}
          </div>
        ) : null}

        <input ref={replaceInputRef} type="file" className="hidden" onChange={handleReplaceFile} accept={ACCEPTED_DOCUMENT_ACCEPT} />

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <DocumentsTable
            documents={filteredDocuments}
            documentAction={documentAction}
            loading={loading}
            error={error && documents.length ? error : ""}
            canManage={canManageDocuments}
            isInternalPortal={isInternalPortal}
            deletingId={deletingId}
            selectedIds={selectedDocumentIds}
            bulkDeleting={bulkDeleting}
            onToggleSelected={toggleSelectedDocument}
            onToggleVisibleSelection={toggleVisibleDocuments}
            onDeleteSelected={requestDeleteSelectedDocuments}
            onDownload={(doc) =>
              openBlob(doc, { download: true }).catch((downloadError) =>
                setMessage(getErrorMessage(downloadError, "Téléchargement sécurisé impossible."))
              )
            }
            onReplace={handleReplace}
            onArchive={handleArchive}
            onDelete={handleDelete}
            onShowAll={showAllDocuments}
            syncLabel={lastSyncLabel}
            returnTo={currentReturnTo}
          />

          <div className="space-y-6">
            <DocumentSummary
              documents={filteredDocuments}
              onSelectAlert={selectDocumentAlert}
              isInternalPortal={isInternalPortal}
              lastAddedLabel={lastAddedLabel}
            />

            {canUploadDocuments ? (
              <UploadPanel
                form={uploadForm}
                parcels={uploadParcelOptions}
                parcelQuery={parcelQuery}
                setParcelQuery={setParcelQuery}
                parcelLoading={parcelOptionsLoading}
                parcelError={parcelOptionsError}
                onChange={handleUploadChange}
                onSubmit={handleUploadSubmit}
                uploading={uploading}
                message=""
                canUpload={canUploadDocuments}
                canManage={canManageDocuments}
                isInternalPortal={isInternalPortal}
              />
            ) : null}
          </div>
        </section>
      </div>

      {pendingDeleteDocument ? (
        <ConfirmDialog
          documentTitle={pendingDeleteDocument.title}
          loading={Boolean(deletingId)}
          onCancel={() => (deletingId ? null : setPendingDeleteDocument(null))}
          onConfirm={executeDelete}
        />
      ) : null}

      {pendingBulkDelete ? (
        <ConfirmDialog
          documentCount={selectedDocumentIds.size}
          loading={bulkDeleting}
          onCancel={() => (bulkDeleting ? null : setPendingBulkDelete(false))}
          onConfirm={executeBulkDelete}
        />
      ) : null}
    </DashboardLayout>
  );
}