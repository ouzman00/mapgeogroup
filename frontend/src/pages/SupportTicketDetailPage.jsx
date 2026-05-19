import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Headphones,
  Paperclip,
  RefreshCw,
  Send,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import LoadingState from "../components/ui/LoadingState";
import useAuth from "../hooks/useAuth";
import supportService from "../services/supportService";
import { getErrorMessage } from "../services/responseUtils";
import {
  SUPPORT_ATTACHMENT_ACCEPT,
  SUPPORT_ATTACHMENT_FORMATS_LABEL,
  SUPPORT_ATTACHMENT_MAX_SIZE_LABEL,
  getSupportPriorityLabel,
  getSupportStatusLabel,
  validateSupportAttachment,
} from "../constants/supportConstants";
import { formatDateLabel, formatDateTimeLabel } from "../utils/dateUtils";

function formatDateTime(value, fallback = "—") {
  return formatDateTimeLabel(value, fallback);
}

function formatShortDate(value, fallback = "—") {
  return formatDateLabel(value, fallback, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

function normalizeTicket(ticket) {
  return {
    ...ticket,
    id: ticket.id,
    reference: ticket.reference || ticket.code || `SUP-${ticket.id || "000"}`,
    subject: ticket.subject || ticket.title || "Échange MAPGEO",
    client: ticket.client_name || ticket.user_name || ticket.organization_name || ticket.user_client_code || ticket.client || "—",
    parcel: ticket.parcel_reference || ticket.parcel || "—",
    parcel_id: ticket.parcel_id || (typeof ticket.parcel === "number" ? ticket.parcel : ""),
    category: ticket.category || "Demande métier",
    priority: ticket.priority || "medium",
    status: ticket.status || "open",
    statusLabel: getSupportStatusLabel(ticket.status),
    lastReply: ticket.last_reply_at_label || formatShortDate(ticket.last_reply_at || ticket.updated_at || ticket.created_at),
    description: ticket.description || ticket.message || "",
    createdAt: formatDateTime(ticket.created_at),
    updatedAt: formatDateTime(ticket.updated_at),
  };
}

function normalizeMessage(message) {
  return {
    id: message.id || `${message.created_at || "message"}-${message.author_name || message.author || "system"}`,
    author_id: message.author_id || message.author || null,
    author: message.author_name || message.author || "Support MAPGEO",
    role: message.is_internal_note ? "Note interne" : message.author_role || message.role || "Conversation",
    date: formatDateTime(message.created_at),
    body: message.body || message.message || "",
    attachment_url: message.attachment_url || message.attachment,
    attachment_name: message.attachment_name || message.filename || "Pièce jointe",
    attachment_size: message.attachment_size || 0,
    has_attachment: Boolean(message.has_attachment || message.attachment_url || message.attachment_name || message.attachment),
    is_internal_note: Boolean(message.is_internal_note),
  };
}

function badgeClasses(value, type = "status") {
  const normalized = String(value || "").toLowerCase();
  if (["critical", "urgent", "haute"].some((term) => normalized.includes(term))) return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (["in_progress", "cours", "attente", "pending"].some((term) => normalized.includes(term))) return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (["resolved", "résolu", "basse"].some((term) => normalized.includes(term))) return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (["closed", "clôturé", "ferm"].some((term) => normalized.includes(term))) return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/75";
  return type === "priority" ? "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary" : "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
}

function priorityLabel(value) {
  return getSupportPriorityLabel(value);
}

function InfoCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
          <Icon size={21} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-secondary/70">{label}</p>
          <p className="mt-1 font-extrabold text-mapgeo-primary">{value || "—"}</p>
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
      <span className="font-extrabold text-white">{value || "—"}</span>
    </div>
  );
}

function ConfirmActionModal({ action, saving, onCancel, onConfirm }) {
  if (!action) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mapgeo-primary/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel">
        <h2 className="text-xl font-extrabold text-mapgeo-primary">{action.title}</h2>
        <p className="mt-3 text-sm leading-6 text-mapgeo-secondary/80">{action.description}</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-2xl border border-mapgeo-line px-5 py-3 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-60"
          >
            {saving ? "Action en cours…" : action.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SupportTicketDetailPage() {
  const { id } = useParams();
  const { user, isInternalPortal } = useAuth();
  const canManageSupport = isInternalPortal && ["admin", "manager"].includes(user?.role);
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState(null);
  const [deletingMessageId, setDeletingMessageId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const attachmentInputRef = useRef(null);

  const loadTicket = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await supportService.getTicketById(id);
      setTicket(normalizeTicket(payload));
      setMessages((payload.messages || []).map(normalizeMessage).filter((message) => isInternalPortal || !message.is_internal_note));
    } catch (loadError) {
      setTicket(null);
      setMessages([]);
      setError(getErrorMessage(loadError, "Impossible de charger le ticket."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isTicketClosed = ticket?.status === "closed";
  const isTicketResolved = ticket?.status === "resolved";
  const canReply = Boolean(ticket?.id && !isTicketClosed);

  async function runTicketAction(action, label) {
    if (!ticket?.id) return;
    setSaving(true);
    setError("");
    setActionMessage("");
    try {
      await action(ticket.id);
      setActionMessage(label);
      setPendingAction(null);
      await loadTicket();
    } catch (updateError) {
      setError(getErrorMessage(updateError, "Action impossible sur ce ticket."));
    } finally {
      setSaving(false);
    }
  }

  function requestTicketAction(actionConfig) {
    if (!ticket?.id) return;
    if (actionConfig.requiresConfirmation) {
      setPendingAction(actionConfig);
      return;
    }
    runTicketAction(actionConfig.action, actionConfig.successMessage);
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    await runTicketAction(pendingAction.action, pendingAction.successMessage);
  }

  async function submitReply(event) {
    event.preventDefault();
    setError("");
    setActionMessage("");

    const trimmedReply = reply.trim();
    if (!ticket?.id) {
      setError("Ticket introuvable.");
      return;
    }
    if (!canReply) {
      setError("Ce ticket est fermé. Rouvrez-le avant d’ajouter une réponse ou une pièce jointe.");
      return;
    }
    if (!trimmedReply) {
      setError("Rédigez une réponse avant l’envoi.");
      return;
    }

    const validationError = validateSupportAttachment(attachment);
    if (validationError) {
      setAttachmentError(validationError);
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const payload = attachment ? new FormData() : { body: trimmedReply, is_internal_note: isInternalNote };
      if (payload instanceof FormData) {
        payload.append("body", trimmedReply);
        payload.append("attachment", attachment);
        if (isInternalNote) payload.append("is_internal_note", "true");
      }
      await supportService.replyToTicket(ticket.id, payload);
      setReply("");
      setAttachment(null);
      setAttachmentError("");
      setIsInternalNote(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      setActionMessage(
        isInternalNote
          ? "Note interne enregistrée. Elle reste invisible côté client."
          : attachment
            ? "Réponse envoyée avec pièce jointe sécurisée."
            : "Réponse envoyée."
      );
      await loadTicket();
    } catch (replyError) {
      setError(getErrorMessage(replyError, "Impossible d’envoyer la réponse."));
    } finally {
      setSaving(false);
    }
  }

  const openAttachment = async (message) => {
    if (!message?.id) return;

    setError("");
    setDownloadingAttachmentId(message.id);

    try {
      const blob = await supportService.downloadAttachment(message.id);
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      setActionMessage("Pièce jointe ouverte via téléchargement sécurisé.");
    } catch (downloadError) {
      setError(getErrorMessage(downloadError, "Impossible d’ouvrir cette pièce jointe sécurisée."));
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  const canDeleteSupportMessage = (message) => {
    if (!message?.id) return false;
    if (canManageSupport) return true;
    if (message.is_internal_note) return false;
    return Boolean(message.author_id && user?.id && Number(message.author_id) === Number(user.id));
  };

  const deleteSupportMessage = async (message) => {
    if (!message?.id || !canDeleteSupportMessage(message)) return;
    const confirmed = window.confirm("Supprimer définitivement ce message support ?");
    if (!confirmed) return;

    setError("");
    setActionMessage("");
    setDeletingMessageId(message.id);

    try {
      await supportService.deleteMessage(message.id);
      setActionMessage("Message support supprimé.");
      await loadTicket();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Impossible de supprimer ce message support."));
    } finally {
      setDeletingMessageId(null);
    }
  };

  const sidebarActions = [
    ...(isInternalPortal && ticket?.status === "open"
      ? [{ label: "Démarrer le traitement", action: supportService.startTicket, successMessage: "Ticket passé en traitement." }]
      : []),
    ...(canManageSupport && !isTicketClosed && !isTicketResolved
      ? [
          { label: "Résoudre", action: supportService.resolveTicket, successMessage: "Ticket résolu.", requiresConfirmation: true, title: "Résoudre le ticket", description: `Le ticket ${ticket?.reference || ""} sera marqué comme résolu.`, confirmLabel: "Résoudre" },
          { label: "Clôturer", action: supportService.closeTicket, successMessage: "Ticket clôturé.", requiresConfirmation: true, title: "Clôturer le ticket", description: `Le ticket ${ticket?.reference || ""} sera fermé et ne pourra plus recevoir de réponse sans réouverture.`, confirmLabel: "Clôturer" },
        ]
      : []),
    ...(canManageSupport && !isTicketClosed && ticket?.priority !== "urgent"
      ? [{ label: "Escalader", action: supportService.escalateTicket, successMessage: "Ticket escaladé.", requiresConfirmation: true, title: "Escalader le ticket", description: `Le ticket ${ticket?.reference || ""} passera en priorité urgente.`, confirmLabel: "Escalader" }]
      : []),
    ...(ticket && (isTicketClosed || isTicketResolved)
      ? [{ label: "Rouvrir", action: supportService.reopenTicket, successMessage: "Ticket rouvert." }]
      : []),
    { label: "Voir l’historique", action: null, scrollToConversation: true },
    ...(canReply ? [{ label: "Ajouter une pièce jointe", action: null, attachFile: true }] : []),
  ];

  return (
    <DashboardLayout
      title={ticket?.reference || "Détail ticket"}
      subtitle={isInternalPortal ? "Conversation, informations métier et suivi de résolution du ticket." : "Consultez votre demande support et échangez avec l’équipe MAPGEO."}
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Support <span className="mx-1 text-mapgeo-secondary/40">/</span> Détail ticket
            </nav>
            <h1 className="mt-3 text-3xl font-extrabold text-mapgeo-primary">{ticket?.subject || "Échange MAPGEO"}</h1>
            <p className="mt-2 text-sm text-mapgeo-secondary/70">{ticket?.reference || "—"}{ticket?.description ? ` · ${ticket.description}` : ""}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/support" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary shadow-soft hover:bg-mapgeo-ivory">
              <ArrowLeft size={18} /> Retour
            </Link>
            {canManageSupport && ticket && !isTicketClosed && !isTicketResolved ? (
              <button
                type="button"
                onClick={() => requestTicketAction({ action: supportService.resolveTicket, successMessage: "Ticket résolu.", requiresConfirmation: true, title: "Résoudre le ticket", description: `Le ticket ${ticket.reference} sera marqué comme résolu.`, confirmLabel: "Résoudre" })}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-60"
              >
                <CheckCircle2 size={18} /> Résoudre
              </button>
            ) : null}
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-4 py-3 text-sm font-medium text-mapgeo-primary">{error}</div> : null}
        {actionMessage ? <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 px-4 py-3 text-sm font-medium text-mapgeo-primary">{actionMessage}</div> : null}
        {loading ? (
          <LoadingState
            title="Veuillez patienter"
            message="Ouverture de la conversation support."
            compact
          />
        ) : null}

        {ticket ? (
          <>
            <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
              {isInternalPortal ? <InfoCard icon={UserRound} label="Client" value={ticket.client} /> : null}
              {ticket.parcel_id ? (
                <Link
                  to={`/parcelles/${ticket.parcel_id}/carto`}
                  state={{ returnTo: `/support/${ticket.id}` }}
                  className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft transition hover:bg-mapgeo-ivory"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
                      <FileText size={21} />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-secondary/70">Parcelle</p>
                      <p className="mt-1 font-extrabold text-mapgeo-primary">{ticket.parcel}</p>
                    </div>
                  </div>
                </Link>
              ) : (
                <InfoCard icon={FileText} label="Parcelle" value={ticket.parcel} />
              )}
              <InfoCard icon={AlertTriangle} label="Priorité" value={priorityLabel(ticket.priority)} />
              <InfoCard icon={Clock3} label="Statut" value={ticket.statusLabel} />
            </section>

            <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-6">
                <section id="ticket-conversation" className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
                  <div className="border-b border-mapgeo-line p-5">
                    <h2 className="text-xl font-extrabold text-mapgeo-primary">Conversation</h2>
                  </div>
                  <div className="space-y-4 p-5">
                    {messages.length ? (
                      messages.map((message) => (
                        <article
                          key={message.id}
                          className={`rounded-3xl border border-mapgeo-line p-4 ${message.is_internal_note ? "bg-mapgeo-sand/10" : "bg-mapgeo-ivory/30"}`}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <strong className="break-words text-mapgeo-primary">{message.author}</strong>
                              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-mapgeo-secondary">{message.role}</span>
                              {message.is_internal_note ? (
                                <span className="rounded-full border border-mapgeo-sand/40 bg-white px-2.5 py-1 text-xs font-extrabold text-mapgeo-primary">
                                  Interne uniquement
                                </span>
                              ) : null}
                              <span className="text-xs text-mapgeo-secondary/70">{message.date}</span>
                            </div>
                            {canDeleteSupportMessage(message) ? (
                              <button
                                type="button"
                                onClick={() => deleteSupportMessage(message)}
                                disabled={deletingMessageId === message.id || saving}
                                className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 size={13} /> {deletingMessageId === message.id ? "Suppression…" : "Supprimer"}
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-mapgeo-secondary/80">{message.body || "—"}</p>
                          {message.has_attachment ? (
                            <button
                              type="button"
                              onClick={() => openAttachment(message)}
                              disabled={downloadingAttachmentId === message.id}
                              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Paperclip size={14} />
                              {downloadingAttachmentId === message.id
                                ? "Ouverture sécurisée…"
                                : message.attachment_name || "Pièce jointe sécurisée"}
                              {formatFileSize(message.attachment_size) ? ` · ${formatFileSize(message.attachment_size)}` : ""}
                            </button>
                          ) : null}
                        </article>
                      ))
                    ) : (
                      <p className="text-sm text-mapgeo-secondary">Aucun message pour ce ticket.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
                  <h2 className="text-xl font-extrabold text-mapgeo-primary">Répondre au ticket</h2>
                  {isTicketClosed ? (
                    <div className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory px-4 py-3 text-sm font-medium text-mapgeo-secondary">
                      Ce ticket est fermé. Rouvrez-le avant d’ajouter une nouvelle réponse ou une pièce jointe.
                    </div>
                  ) : null}
                  <form onSubmit={submitReply} className="mt-4 space-y-4">
                    <textarea
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      rows={5}
                      disabled={!canReply || saving}
                      placeholder={canReply ? "Rédigez votre réponse..." : "Ticket fermé"}
                      className="w-full rounded-3xl border border-mapgeo-line px-4 py-3 text-sm outline-none focus:border-mapgeo-accent disabled:bg-mapgeo-ivory disabled:text-mapgeo-secondary/60"
                    />
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <label className={`inline-flex items-center gap-2 rounded-2xl border border-dashed border-mapgeo-line bg-mapgeo-ivory/30 px-4 py-3 text-sm font-semibold text-mapgeo-secondary ${canReply ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                          <Paperclip size={17} /> {attachment?.name || "Ajouter une pièce jointe"}
                          <input
                            ref={attachmentInputRef}
                            type="file"
                            disabled={!canReply || saving}
                            accept={SUPPORT_ATTACHMENT_ACCEPT}
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              const validationError = validateSupportAttachment(file);
                              setAttachmentError(validationError);
                              setAttachment(validationError ? null : file);
                            }}
                            className="hidden"
                          />
                        </label>
                        <p className="text-xs text-mapgeo-secondary/70">
                          Formats acceptés : {SUPPORT_ATTACHMENT_FORMATS_LABEL} (Max. {SUPPORT_ATTACHMENT_MAX_SIZE_LABEL})
                        </p>
                        {attachmentError ? <p className="text-xs font-bold text-mapgeo-primary">{attachmentError}</p> : null}
                        {isInternalPortal ? (
                          <label className="flex items-center gap-2 text-xs font-bold text-mapgeo-secondary/80">
                            <input
                              type="checkbox"
                              checked={isInternalNote}
                              disabled={!canReply || saving}
                              onChange={(event) => setIsInternalNote(event.target.checked)}
                              className="h-4 w-4 rounded border-mapgeo-line"
                            />
                            Note interne — invisible pour le client et réservée à l’équipe MAPGEO
                          </label>
                        ) : null}
                      </div>
                      <button type="submit" disabled={saving || !canReply || !reply.trim()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-60">
                        <Send size={17} /> {saving ? "Envoi…" : "Envoyer la réponse"}
                      </button>
                    </div>
                  </form>
                </section>
              </div>

              <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
                <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">{isInternalPortal ? "Résumé du ticket" : "Résumé de ma demande"}</h3>
                <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
                  <Summary icon={Headphones} label="Référence" value={ticket.reference} />
                  {isInternalPortal ? <Summary icon={UserRound} label="Client" value={ticket.client} /> : null}
                  <Summary icon={FileText} label="Catégorie" value={ticket.category} />
                  <Summary icon={CalendarDays} label="Créé le" value={ticket.createdAt} />
                  <Summary icon={Clock3} label="Dernière réponse" value={ticket.lastReply} />
                </div>
                <div className="mt-5 space-y-3">
                  <span className={`inline-flex rounded-xl border px-3 py-1.5 text-xs font-bold ${badgeClasses(ticket.priority, "priority")}`}>{priorityLabel(ticket.priority)}</span>
                  <span className={`ml-2 inline-flex rounded-xl border px-3 py-1.5 text-xs font-bold ${badgeClasses(ticket.status)}`}>{ticket.statusLabel}</span>
                </div>
                <div className="mt-5 space-y-2">
                  {sidebarActions.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        if (item.scrollToConversation) {
                          document.getElementById("ticket-conversation")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          return;
                        }
                        if (item.attachFile) {
                          attachmentInputRef.current?.click();
                          return;
                        }
                        requestTicketAction(item);
                      }}
                      disabled={saving}
                      className="flex w-full items-center gap-3 rounded-2xl py-2 text-left text-sm font-semibold text-white/90 hover:bg-white/5 disabled:opacity-60"
                    >
                      <span className="flex-1">{item.label}</span>
                      {item.label === "Rouvrir" ? <RefreshCw size={16} className="text-white/60" /> : item.label === "Clôturer" ? <XCircle size={16} className="text-white/60" /> : <ChevronRight size={16} className="text-white/60" />}
                    </button>
                  ))}
                </div>
              </aside>
            </section>
          </>
        ) : null}
      </div>
      <ConfirmActionModal
        action={pendingAction}
        saving={saving}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </DashboardLayout>
  );
}
