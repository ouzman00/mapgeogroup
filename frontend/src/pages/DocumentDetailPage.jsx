import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Globe2,
  History,
  Layers3,
  Map,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import documentService from "../services/documentService";
import { getErrorMessage } from "../services/responseUtils";
import { DOCUMENT_STATUS_OPTIONS, DOCUMENT_TYPE_OPTIONS, getDocumentVisibilityLabel, validateDocumentFile } from "../constants/documentConstants";
import { formatDateLabel, formatDateTimeLabel } from "../utils/dateUtils";

function labelFromOptions(options, value, fallback = "—") {
  return options.find(([optionValue]) => optionValue === value)?.[1] || value || fallback;
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

function normalizeVersion(version, index = 0) {
  return {
    id: version.id ?? `${version.version || "v1"}-${index}`,
    version: version.version || "v1",
    status: version.status || "—",
    statusLabel: version.status_label || labelFromOptions(DOCUMENT_STATUS_OPTIONS, version.status, version.status || "—"),
    dateLabel: version.date_label || formatDateTime(version.created_at || version.updated_at || version.date),
    author: version.author || version.uploaded_by_name || "—",
  };
}

function normalizeDocument(doc) {
  const rawId = doc.id ?? null;
  const title = doc.title || doc.name || doc.file_name || "Document sans titre";
  const status = doc.status || "draft";
  const documentType = doc.document_type || doc.type || "other";
  const rawVersions = Array.isArray(doc.versions) ? doc.versions : [];

  return {
    ...doc,
    id: rawId,
    title,
    file_name: doc.file_name || doc.original_filename || title,
    typeLabel: doc.typeLabel || doc.document_type_label || doc.type_label || labelFromOptions(DOCUMENT_TYPE_OPTIONS, documentType, "Autre"),
    parcel_reference: doc.parcel_reference || doc.parcel?.reference || (typeof doc.parcel === "string" ? doc.parcel : "—"),
    parcel_id: doc.parcel_id || doc.parcel?.id || (typeof doc.parcel === "number" ? doc.parcel : ""),
    client_name: doc.client_name || doc.owner_name || doc.organization_name || doc.client?.name || "—",
    version: doc.version || "v1",
    status,
    statusLabel: doc.statusLabel || doc.status_label || doc.status_display || labelFromOptions(DOCUMENT_STATUS_OPTIONS, status, "Brouillon"),
    is_public_for_client: Boolean(doc.is_public_for_client ?? doc.visible_client ?? doc.public ?? false),
    created_at_label: doc.created_at_label || formatDate(doc.created_at),
    updated_at_label: doc.updated_at_label || formatDateTime(doc.updated_at),
    description: doc.description || "",
    file_size_label: doc.file_size_label || formatFileSize(doc.file_size ?? doc.size),
    versions: rawVersions.map(normalizeVersion),
  };
}


function statusClasses(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("brouillon") || value.includes("draft")) return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (value.includes("archiv")) return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/75";
  return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
          <Icon size={21} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-secondary/70">{label}</p>
          <p className="mt-1 font-extrabold text-mapgeo-primary">{value}</p>
        </div>
      </div>
    </div>
  );
}

function Summary({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={17} className="text-white/70" />
      <span className="flex-1 text-white/80">{label}</span>
      <span className="font-extrabold text-white">{value}</span>
    </div>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isInternalPortal } = useAuth();
  const canManageDocuments = isInternalPortal && ["admin", "manager"].includes(user?.role);
  const replaceInputRef = useRef(null);
  const [documentItem, setDocumentItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fileAction, setFileAction] = useState(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      setMessage("");
      try {
        const payload = await documentService.getDocumentById(id);
        if (!active) return;
        setDocumentItem(normalizeDocument(payload));
      } catch (loadError) {
        if (!active) return;
        setError(getErrorMessage(loadError, "Impossible de charger le document."));
        setDocumentItem(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [id]);

  const versions = useMemo(() => {
    if (!documentItem) return [];
    if (documentItem.versions.length) return documentItem.versions;

    return [
      normalizeVersion({
        id: documentItem.id,
        version: documentItem.version,
        status: documentItem.status,
        status_label: documentItem.statusLabel,
        updated_at: documentItem.updated_at || documentItem.created_at,
        author: documentItem.uploaded_by_name || "—",
      }),
    ];
  }, [documentItem]);

  const ensureDocumentId = (actionLabel) => {
    if (documentItem?.id) return true;
    setError(`Impossible de ${actionLabel} ce document : identifiant manquant.`);
    return false;
  };

  const openBlob = async ({ download = false } = {}) => {
    if (!documentItem || !ensureDocumentId(download ? "télécharger" : "prévisualiser")) return;

    setFileAction(download ? "download" : "preview");
    setMessage("");

    try {
      const blob = await documentService.downloadDocument(documentItem.id);
      const blobUrl = URL.createObjectURL(blob);

      if (download) {
        const link = globalThis.document.createElement("a");
        link.href = blobUrl;
        link.download = documentItem.file_name || documentItem.title || "document";
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
      setFileAction(null);
    }
  };

  const handleDownload = () => {
    setError("");
    openBlob({ download: true }).catch((downloadError) => setError(getErrorMessage(downloadError, "Téléchargement sécurisé impossible pour ce document.")));
  };

  const handlePreview = () => {
    setError("");
    openBlob({ download: false }).catch((previewError) => setError(getErrorMessage(previewError, "Aperçu sécurisé impossible pour ce document.")));
  };

  const handleReplace = () => {
    if (!canManageDocuments || !ensureDocumentId("remplacer")) return;
    replaceInputRef.current?.click();
  };

  const handleReplaceFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !documentItem || !canManageDocuments || !ensureDocumentId("remplacer")) return;

    const validationMessage = validateDocumentFile(file);
    if (validationMessage) {
      setError(validationMessage);
      event.target.value = "";
      return;
    }

    setReplacing(true);
    setError("");
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("title", documentItem.title);
      formData.append("version", documentItem.version || "v1");
      formData.append("status", documentItem.status || "draft");
      formData.append("description", documentItem.description || "");
      formData.append("is_public_for_client", String(documentItem.is_public_for_client));
      formData.append("file", file);
      const updated = await documentService.updateDocument(documentItem.id, formData);
      setDocumentItem(normalizeDocument(updated));
      setMessage("Document remplacé avec succès.");
    } catch (replaceError) {
      setError(getErrorMessage(replaceError, "Remplacement impossible."));
    } finally {
      setReplacing(false);
      event.target.value = "";
    }
  };

  const handleArchive = async () => {
    if (!documentItem || !canManageDocuments || !ensureDocumentId("archiver")) return;
    setArchiving(true);
    setError("");
    setMessage("");

    try {
      const updated = await documentService.updateDocument(documentItem.id, {
        status: "archived",
        is_public_for_client: false,
      });
      setDocumentItem(normalizeDocument(updated));
      setMessage("Document archivé.");
    } catch (archiveError) {
      setError(getErrorMessage(archiveError, "Archivage impossible."));
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = () => {
    if (!documentItem || !canManageDocuments || !ensureDocumentId("supprimer")) return;
    setConfirmDeleteOpen(true);
  };

  const executeDelete = async () => {
    if (!documentItem?.id || !canManageDocuments) return;

    setDeleting(true);
    setError("");
    setMessage("");

    try {
      await documentService.deleteDocument(documentItem.id);
      navigate("/documents");
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Suppression impossible."));
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const actions = [
    { label: fileAction === "download" ? "Téléchargement…" : "Téléchargement sécurisé", icon: Download, onClick: handleDownload, disabled: !documentItem?.id || Boolean(fileAction) },
    { label: fileAction === "preview" ? "Ouverture de l’aperçu…" : "Aperçu sécurisé", icon: Eye, onClick: handlePreview, disabled: !documentItem?.id || Boolean(fileAction) },
    ...(canManageDocuments
      ? [
          { label: replacing ? "Remplacement…" : "Remplacer", icon: RotateCcw, onClick: handleReplace, disabled: replacing },
          { label: archiving ? "Archivage…" : "Archiver", icon: Archive, onClick: handleArchive, disabled: archiving || documentItem?.status === "archived" },
          { label: deleting ? "Suppression…" : "Supprimer", icon: Trash2, onClick: handleDelete, disabled: deleting },
          { label: "Historique complet", icon: History, onClick: () => globalThis.document.getElementById("document-versions")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
        ]
      : []),
  ];

  return (
    <DashboardLayout
      title={documentItem?.title || "Détail document"}
      subtitle={isInternalPortal ? "Prévisualisation, versions, visibilité et actions documentaires." : "Consultez et téléchargez ce document rattaché à vos parcelles."}
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Documents <span className="mx-1 text-mapgeo-secondary/40">/</span> Détail document
            </nav>
            <h1 className="mt-3 text-3xl font-extrabold text-mapgeo-primary">{documentItem?.title || "Document"}</h1>
            {documentItem?.description ? <p className="mt-2 text-sm text-mapgeo-secondary/70">{documentItem.description}</p> : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/documents" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary shadow-soft hover:bg-mapgeo-ivory">
              <ArrowLeft size={18} /> Retour
            </Link>
            <button type="button" onClick={handleDownload} disabled={!documentItem?.id || Boolean(fileAction)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-60">
              <Download size={18} /> {fileAction === "download" ? "Téléchargement…" : "Téléchargement sécurisé"}
            </button>
            {canManageDocuments ? (
              <button
                type="button"
                onClick={handleReplace}
                disabled={replacing || !documentItem?.id}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary shadow-soft hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw size={18} /> {replacing ? "Remplacement…" : "Remplacer"}
              </button>
            ) : null}
          </div>
        </section>

        {canManageDocuments ? <input ref={replaceInputRef} type="file" className="hidden" onChange={handleReplaceFile} accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.kml,.kmz,.dxf,.dwg,.zip,.txt" /> : null}
        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
        {message ? <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-4 py-3 text-sm font-medium text-mapgeo-primary">{message}</div> : null}
        {loading ? <div className="rounded-3xl border border-mapgeo-line bg-white p-6 text-mapgeo-secondary shadow-soft">Chargement du document…</div> : null}

        {documentItem ? (
          <>
            <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
              <Metric icon={FileText} label="Type" value={documentItem.typeLabel} />
              <Metric icon={Layers3} label="Version" value={documentItem.version} />
              <Metric icon={ShieldCheck} label="Statut" value={documentItem.statusLabel} />
              {isInternalPortal ? <Metric icon={Globe2} label="Visibilité" value={getDocumentVisibilityLabel(documentItem)} /> : null}
            </section>

            <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-6">
                <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
                  <div className="border-b border-mapgeo-line p-5">
                    <h2 className="text-xl font-extrabold text-mapgeo-primary">Aperçu du document</h2>
                    <p className="mt-1 text-sm text-mapgeo-secondary/70">{isInternalPortal ? "Prévisualisation administrative du livrable." : "Prévisualisez ou téléchargez ce document."}</p>
                  </div>
                  <div className="p-6">
                    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-mapgeo-line bg-mapgeo-ivory/40 text-center">
                      <FileText size={48} className="text-mapgeo-primary" />
                      <h3 className="mt-4 text-xl font-extrabold text-mapgeo-primary">{documentItem.title}</h3>
                      <p className="mt-2 max-w-md text-sm leading-6 text-mapgeo-secondary/70">Document rattaché à la parcelle {documentItem.parcel_reference}. L’aperçu et le téléchargement passent par une route sécurisée authentifiée.</p>
                      <button
                        type="button"
                        onClick={handlePreview}
                        disabled={!documentItem?.id || Boolean(fileAction)}
                        className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary shadow-soft disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Eye size={17} /> {fileAction === "preview" ? "Ouverture sécurisée…" : "Aperçu sécurisé"}
                      </button>
                    </div>
                  </div>
                </section>

                {isInternalPortal ? (
                  <section id="document-versions" className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
                    <div className="border-b border-mapgeo-line p-5">
                      <h2 className="text-xl font-extrabold text-mapgeo-primary">Historique des versions</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-[720px] w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
                            <th className="px-5 py-4">Version</th>
                            <th className="px-5 py-4">Statut</th>
                            <th className="px-5 py-4">Date</th>
                            <th className="px-5 py-4">Auteur</th>
                            <th className="px-5 py-4">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-mapgeo-line">
                          {versions.length ? (
                            versions.map((version) => (
                              <tr key={version.version || version.id}>
                                <td className="px-5 py-4 font-extrabold text-mapgeo-primary">{version.version || "v1"}</td>
                                <td className="px-5 py-4"><span className={`rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${statusClasses(version.status)}`}>{version.statusLabel}</span></td>
                                <td className="px-5 py-4 text-mapgeo-secondary">{version.dateLabel}</td>
                                <td className="px-5 py-4 text-mapgeo-secondary">{version.author}</td>
                                <td className="px-5 py-4"><button type="button" onClick={handleDownload} disabled={Boolean(fileAction)} className="text-sm font-bold text-mapgeo-primary disabled:cursor-not-allowed disabled:opacity-50">{fileAction === "download" ? "Téléchargement…" : "Téléchargement sécurisé"}</button></td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan="5" className="px-5 py-8 text-center text-mapgeo-secondary">Aucun historique de version disponible.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}
              </div>

              <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
                <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">{isInternalPortal ? "Résumé documentaire" : "Résumé du document"}</h3>
                <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
                  <Summary icon={Map} label="Parcelle" value={documentItem.parcel_reference} />
                  {isInternalPortal ? <Summary icon={UserRound} label="Client" value={documentItem.client_name} /> : null}
                  <Summary icon={CalendarDays} label="Date d’ajout" value={documentItem.created_at_label} />
                  <Summary icon={FileText} label="Taille" value={documentItem.file_size_label} />
                  {isInternalPortal ? <Summary icon={Globe2} label="Visibilité" value={getDocumentVisibilityLabel(documentItem)} /> : null}
                  {documentItem.parcel_id ? (
                    <Link
                      to={`/parcelles/${documentItem.parcel_id}/carto`}
                      state={{ returnTo: `/documents/${documentItem.id}` }}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/15"
                    >
                      <Layers3 size={16} /> Ouvrir la parcelle sur la carte
                    </Link>
                  ) : null}
                </div>
                <div className="mt-5 space-y-3">
                  {actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button key={action.label} type="button" onClick={action.onClick} disabled={action.disabled} className="flex w-full items-center gap-3 rounded-2xl py-2 text-left text-sm font-semibold text-white/90 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">
                        <Icon size={17} className="text-white/70" />
                        <span className="flex-1">{action.label}</span>
                        <ChevronRight size={16} className="text-white/60" />
                      </button>
                    );
                  })}
                </div>
              </aside>
            </section>
          </>
        ) : null}

        {confirmDeleteOpen && documentItem ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-mapgeo-primary/35 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirmation de suppression">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-panel">
              <h2 className="text-xl font-extrabold text-mapgeo-primary">Supprimer ce document ?</h2>
              <p className="mt-3 text-sm leading-6 text-mapgeo-secondary/75">
                Le document « {documentItem.title} » sera supprimé définitivement de la bibliothèque documentaire.
              </p>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={deleting}
                  className="rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={executeDelete}
                  disabled={deleting}
                  className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-extrabold text-white shadow-panel hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
