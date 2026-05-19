import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileText,
  KeyRound,
  Mail,
  Map,
  MessageCircle,
  Phone,
  RefreshCcw,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import AdminMapLayersPanel from "../components/admin/AdminMapLayersPanel";
import LoadingState from "../components/ui/LoadingState";
import { deactivateUser, fetchAllClients, fetchClientById, resetClientAccess, updateClient } from "../services/clientService";
import parcelService from "../services/parcelService";
import documentService from "../services/documentService";
import supportService from "../services/supportService";
import { getErrorMessage, isNotFoundError } from "../services/responseUtils";
import { getDocumentVisibilityLabel } from "../constants/documentConstants";
import { getPortalAccessActionLabel, getPortalAccessLabel } from "../constants/clientConstants";
import { getParcelStatusLabel, progressFromStatus } from "../constants/parcelConstants";
import { getSupportPriorityLabel, getSupportStatusLabel, isResolvedOrClosed } from "../constants/supportConstants";
import { formatDateLabel as safeFormatDateLabel } from "../utils/dateUtils";

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function formatDateLabel(value) {
  return safeFormatDateLabel(value, "—", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatArea(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(number)} m²`;
}

function normalizeClient(client = {}, index = 0) {
  const metadata = client.metadata || {};
  const primaryName = client.primary_user_name || [client.first_name, client.last_name].filter(Boolean).join(" ");

  return {
    ...client,
    id: client.id || client.code || `client-${index}`,
    name: client.name || client.company_name || metadata.company_name || "Client",
    code: client.code || client.client_code || client.primary_user_client_code || `CL-${String(index + 1).padStart(3, "0")}`,
    status: client.status || "active",
    email: client.email || client.primary_user_email || metadata.email || "—",
    phone: client.phone || metadata.phone || "—",
    address: client.address || metadata.address || client.commune || "—",
    contact_name: client.contact_name || primaryName || client.name || "Contact principal",
    parcels_count: Number(client.parcels_count ?? client.parcel_count ?? 0),
  };
}

function statusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("prospect")) return "Prospect";
  if (value.includes("inactive") || value.includes("inactif")) return "Inactif";
  if (value.includes("archive")) return "Archivé";
  return "Actif";
}

function statusClasses(status) {
  const label = statusLabel(status);
  if (label === "Actif") return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (label === "Prospect") return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  if (label === "Inactif") return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/75";
}

function progressClasses(value) {
  if (value >= 95) return "bg-mapgeo-primary";
  if (value >= 60) return "bg-mapgeo-primary";
  if (value >= 35) return "bg-mapgeo-sand";
  return "bg-mapgeo-primary/70";
}

function portalAccessLabel(client) {
  return getPortalAccessLabel(client);
}

function buildClientFilterValue(client) {
  return client?.code || client?.primary_user_client_code || client?.client_code || "";
}

function buildOrganizationId(client) {
  // organization_id est l'ID de l'organisation (table Organization)
  // client.id peut être l'ID de l'organisation si l'endpoint retourne directement une org
  // Si organization_id est absent et que id semble être un ID d'organisation, on l'utilise
  const orgId = client?.organization_id ?? client?.id ?? "";
  return orgId ? String(orgId) : "";
}

function buildHref(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const normalizedValue = String(value ?? "").trim();
    if (normalizedValue) query.set(key, normalizedValue);
  });
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function fetchClientSafely(id) {
  try {
    return normalizeClient(await fetchClientById(id));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const clientsPayload = await fetchAllClients({ ordering: "name" });
  const clients = (clientsPayload.results || []).map(normalizeClient);
  const found = clients.find((item) => String(item.id) === String(id) || String(item.code) === String(id));

  if (!found) throw new Error("Client introuvable dans l’API.");
  return found;
}

async function loadRelatedData(selectedClient) {
  const organizationId = buildOrganizationId(selectedClient);
  const organizationCode = selectedClient?.code;
  const ownerCode = selectedClient?.primary_user_client_code || selectedClient?.code;

  const [parcelsPayload, documentsPayload, ticketsPayload] = await Promise.allSettled([
    parcelService.getAllParcels({ organization_id: organizationId, organization_code: organizationCode }),
    documentService.getAllDocuments({ organization_id: organizationId, organization_code: organizationCode }),
    supportService.getAllTickets({ organization_id: organizationId, organization_code: organizationCode }),
  ]);

  let parcels = parcelsPayload.status === "fulfilled" ? (parcelsPayload.value.results || []) : [];

  if (!parcels.length && ownerCode) {
    const fallbackPayload = await parcelService.getAllParcels({ owner_client_code: ownerCode }).catch(() => null);
    parcels = fallbackPayload?.results || [];
  }

  if (!parcels.length && organizationCode) {
    const fallbackPayload = await parcelService.getAllParcels({ organization_code: organizationCode }).catch(() => null);
    parcels = fallbackPayload?.results || [];
  }

  return {
    parcels,
    documents: documentsPayload.status === "fulfilled" ? (documentsPayload.value.results || []) : [],
    tickets: ticketsPayload.status === "fulfilled" ? (ticketsPayload.value.results || []) : [],
  };
}

function KpiCard({ icon: Icon, label, value, description }) {
  return (
    <article className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
          <Icon size={23} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-secondary/70">{label}</p>
          <p className="mt-2 text-3xl font-extrabold text-mapgeo-primary">{value}</p>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">{description}</p>
        </div>
      </div>
    </article>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-mapgeo-line bg-white px-4 py-3">
      <Icon size={17} className="text-mapgeo-primary" />
      <span className="flex-1 text-sm text-mapgeo-secondary">{label}</span>
      <span className="text-right text-sm font-extrabold text-mapgeo-primary">{value || "—"}</span>
    </div>
  );
}

function InfoSummary({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={17} className="text-white/70" />
      <span className="flex-1 text-white/80">{label}</span>
      <span className="font-extrabold text-white">{value}</span>
    </div>
  );
}

function DetailTable({ title, columns, children, action, empty, colSpan }) {
  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
      <div className="flex items-center justify-between border-b border-mapgeo-line p-5">
        <h3 className="text-xl font-extrabold text-mapgeo-primary">{title}</h3>
        {action}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
              {columns.map((column) => <th key={column} className="px-5 py-4">{column}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-mapgeo-line">
            {children || (
              <tr>
                <td colSpan={colSpan || columns.length} className="px-5 py-8 text-center text-mapgeo-secondary">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConfirmDialog({ open, title, description, actionLabel, loading, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-mapgeo-primary/40 px-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mapgeo-secondary/70">Confirmation</p>
            <h2 className="mt-2 text-2xl font-extrabold text-mapgeo-primary">{title}</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-2xl p-2 text-mapgeo-secondary hover:bg-mapgeo-ivory disabled:opacity-50" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-mapgeo-secondary">{description}</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} disabled={loading} className="rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-50">
            {loading ? "Traitement…" : actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [parcels, setParcels] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      setMessage("");

      try {
        const selected = await fetchClientSafely(id);
        const related = await loadRelatedData(selected);

        if (!active) return;
        setClient(selected);
        setParcels(related.parcels);
        setDocuments(related.documents);
        setTickets(related.tickets);
      } catch (loadError) {
        if (!active) return;
        setError(getErrorMessage(loadError, "Impossible de charger la fiche client."));
        setClient(null);
        setParcels([]);
        setDocuments([]);
        setTickets([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [id]);

  const avgProgress = useMemo(() => {
    if (!parcels.length) return 0;
    return Math.round(parcels.reduce((sum, parcel) => sum + Number(parcel.progress || 0), 0) / parcels.length);
  }, [parcels]);

  const resetAccess = async () => {
    if (!client || actionLoading) return;
    setMessage("");
    setError("");

    if (!client.primary_user_id) {
      setError("Aucun compte portail principal n’est lié à ce client.");
      return;
    }

    setActionLoading(true);
    try {
      const result = await resetClientAccess(client.primary_user_id);
      const suffix = result?.reset_sent ? " Un lien sécurisé a été envoyé par e-mail." : " Aucun e-mail n’a pu être envoyé.";
      setClient((current) => current ? { ...current, status: "active", primary_user_is_active: true, portal_access_status: "active" } : current);
      setMessage(`Accès réinitialisé pour ${client.name}. Le client est repassé en actif et son accès portail est réinitialisé.${suffix}`);
    } catch (resetError) {
      setError(getErrorMessage(resetError, "Réinitialisation impossible."));
    } finally {
      setActionLoading(false);
    }
  };

  const deactivateClient = async () => {
    if (!client || actionLoading) return;
    setMessage("");
    setError("");
    setActionLoading(true);

    try {
      const updated = await updateClient(client.id, { status: "inactive" });

      if (client.primary_user_id) {
        await deactivateUser(client.primary_user_id);
      }

      setClient({ ...normalizeClient(updated), primary_user_is_active: false, portal_access_status: "disabled" });
      setMessage("Client et accès portail désactivés.");
      setConfirmDeactivateOpen(false);
    } catch (updateError) {
      setError(getErrorMessage(updateError, "Désactivation impossible."));
    } finally {
      setActionLoading(false);
    }
  };

  const title = client?.name || "Détail client";
  const clientFilterValue = buildClientFilterValue(client);
  const organizationId = buildOrganizationId(client);
  const returnTo = buildHref(`/clients/${id}`, {});
  const parcelsHref = buildHref("/parcelles", { organization_code: clientFilterValue });
  const documentsHref = buildHref("/documents", { organization_code: clientFilterValue });
  const supportHref = buildHref("/support", { organization_code: clientFilterValue });
  const cartoHref = buildHref("/parcelles/carto", { organization_code: clientFilterValue, organization_id: organizationId, returnTo });

  const draftDocuments = documents.filter((doc) => String(doc.status || "").toLowerCase().includes("draft") || String(doc.status || "").toLowerCase().includes("brouillon")).length;
  const criticalTickets = tickets.filter((ticket) => ["high", "urgent", "critical", "haute", "critique"].includes(String(ticket.priority || "").toLowerCase())).length;
  const parcelsToVerify = parcels.filter((parcel) => ["to_verify", "pending", "review", "en vérification"].includes(String(parcel.status || "").toLowerCase())).length;
  const openTickets = tickets.filter((ticket) => !isResolvedOrClosed(ticket.status)).length;

  const portalLabel = portalAccessLabel(client);
  const accessActionLabel = getPortalAccessActionLabel(client);

  const clientAlerts = [
    { label: `${draftDocuments} livrable(s) en préparation`, href: documentsHref },
    { label: `${criticalTickets} échange(s) prioritaire(s)`, href: supportHref },
    { label: `${parcelsToVerify} parcelle(s) à vérifier`, href: buildHref("/parcelles", { organization_code: clientFilterValue, status: "to_verify" }) },
    { label: `${accessActionLabel} · portail ${portalLabel.toLowerCase()}`, onClick: resetAccess },
  ];

  return (
    <DashboardLayout title={title} subtitle="Fiche client, portefeuille foncier, livrables et échanges MAPGEO.">
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Clients <span className="mx-1 text-mapgeo-secondary/40">/</span> Détail client
            </nav>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-extrabold tracking-tight text-mapgeo-primary">{title}</h1>
              {client ? <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClasses(client.status)}`}>{statusLabel(client.status)}</span> : null}
            </div>
            <p className="mt-2 text-sm text-mapgeo-secondary/70">Code client : {client?.code || "—"}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/clients" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary shadow-soft hover:bg-mapgeo-ivory"><ArrowLeft size={18} /> Retour</Link>
            <Link to={cartoHref} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary shadow-soft hover:bg-mapgeo-ivory"><Map size={18} /> Carte</Link>
            <button type="button" onClick={resetAccess} disabled={!client?.primary_user_id || actionLoading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-50"><KeyRound size={18} /> {accessActionLabel}</button>
            <button type="button" onClick={() => setConfirmDeactivateOpen(true)} disabled={!client || statusLabel(client.status) === "Inactif" || actionLoading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary shadow-soft hover:bg-mapgeo-sand/10 disabled:cursor-not-allowed disabled:opacity-50"><AlertTriangle size={18} /> Désactiver</button>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-4 py-3 text-sm font-medium text-mapgeo-primary">{error}</div> : null}
        {message ? <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 px-4 py-3 text-sm font-medium text-mapgeo-primary">{message}</div> : null}
        {loading ? (
          <LoadingState
            title="Veuillez patienter"
            message="Ouverture du dossier client."
            compact
          />
        ) : null}

        {client ? (
          <>
            <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
              <KpiCard icon={Map} label="Parcelles" value={formatNumber(parcels.length || client.parcels_count)} description="Portefeuille foncier" />
              <KpiCard icon={FileText} label="Documents" value={formatNumber(documents.length)} description="Plans et rapports liés" />
              <KpiCard icon={MessageCircle} label="Échanges ouverts" value={formatNumber(openTickets)} description="Échanges MAPGEO" />
              <KpiCard icon={BriefcaseBusiness} label="Avancement moyen" value={`${avgProgress}%`} description="Progression portefeuille" />
            </section>

            <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-6">
                <section className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
                  <h2 className="text-xl font-extrabold text-mapgeo-primary">Informations client</h2>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <InfoRow icon={UserRound} label="Contact" value={client.contact_name} />
                    <InfoRow icon={Mail} label="Email" value={client.email} />
                    <InfoRow icon={Phone} label="Téléphone" value={client.phone} />
                    <InfoRow icon={Map} label="Commune / zone" value={client.address} />
                    <InfoRow icon={ShieldCheck} label="Accès portail" value={portalAccessLabel(client)} />
                    <InfoRow icon={UsersRound} label="Membres actifs" value={formatNumber(client.member_count || 0)} />
                    <InfoRow icon={CalendarDays} label="Créé le" value={formatDateLabel(client.created_at)} />
                    <InfoRow icon={RefreshCcw} label="Mis à jour le" value={formatDateLabel(client.updated_at)} />
                  </div>
                </section>

                {["admin", "manager"].includes(user?.role) ? (
                  organizationId
                    ? <AdminMapLayersPanel clientId={organizationId} />
                    : (
                      <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm text-mapgeo-secondary">
                        <strong className="text-mapgeo-primary">Couches SIG non disponibles :</strong> impossible de déterminer l'organisation liée à ce client. Vérifiez que ce client est bien rattaché à une organisation dans le back-office.
                      </div>
                    )
                ) : null}

                <DetailTable title="Portefeuille foncier du client" columns={["Référence", "Commune", "Surface", "Avancement", "Avancement", "Action"]} action={<Link to={parcelsHref} className="text-sm font-bold text-mapgeo-primary">Voir tout</Link>} empty="Aucune parcelle liée à ce client." colSpan={6}>
                  {parcels.length ? parcels.map((parcel) => {
                    const progress = Math.min(Math.max(Number(parcel.progress ?? progressFromStatus(parcel.status)), 0), 100);
                    return (
                      <tr key={parcel.id || parcel.reference}>
                        <td className="px-5 py-4 font-extrabold text-mapgeo-primary">{parcel.reference || parcel.title_number || "—"}</td>
                        <td className="px-5 py-4 text-mapgeo-secondary">{parcel.commune || parcel.location || "—"}</td>
                        <td className="px-5 py-4 text-mapgeo-secondary">{formatArea(parcel.area ?? parcel.surface ?? parcel.computed_area)}</td>
                        <td className="px-5 py-4"><span className="rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-2.5 py-1 text-xs font-bold text-mapgeo-primary">{parcel.status_label || getParcelStatusLabel(parcel.status)}</span></td>
                        <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="w-10 text-xs font-bold">{progress}%</span><span className="h-2 w-24 rounded-full bg-mapgeo-ivory"><span className={`block h-2 rounded-full ${progressClasses(progress)}`} style={{ width: `${progress}%` }} /></span></div></td>
                        <td className="px-5 py-4"><Link to={`/parcelles/${parcel.id}`} className="text-sm font-bold text-mapgeo-primary">Ouvrir</Link></td>
                      </tr>
                    );
                  }) : null}
                </DetailTable>

                <DetailTable title="Plans, rapports et livrables liés" columns={["Document", "Type", "Avancement", "Visibilité", "Date", "Action"]} action={<Link to={documentsHref} className="text-sm font-bold text-mapgeo-primary">Bibliothèque des livrables</Link>} empty="Aucun livrable lié à ce client." colSpan={6}>
                  {documents.length ? documents.map((doc) => (
                    <tr key={doc.id || doc.title}>
                      <td className="px-5 py-4 font-extrabold text-mapgeo-primary">{doc.title || doc.name || "Document"}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{doc.document_type_label || doc.document_type || doc.type || doc.typeLabel || "Document"}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{doc.status_label || doc.status || doc.statusLabel || "—"}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{getDocumentVisibilityLabel(doc)}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{formatDateLabel(doc.created_at || doc.date || doc.created)}</td>
                      <td className="px-5 py-4">{doc.id ? <Link to={`/documents/${doc.id}`} className="text-sm font-bold text-mapgeo-primary">Consulter</Link> : "—"}</td>
                    </tr>
                  )) : null}
                </DetailTable>

                <DetailTable title="Échanges MAPGEO liés" columns={["Référence", "Sujet", "Priorité", "Avancement", "Date", "Action"]} action={<Link to={supportHref} className="text-sm font-bold text-mapgeo-primary">Contacter MAPGEO</Link>} empty="Aucun échange MAPGEO lié à ce client." colSpan={6}>
                  {tickets.length ? tickets.map((ticket) => (
                    <tr key={ticket.id || ticket.reference}>
                      <td className="px-5 py-4 font-extrabold text-mapgeo-primary">{ticket.reference || `SUP-${ticket.id}`}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{ticket.subject || "—"}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{ticket.priority_label || getSupportPriorityLabel(ticket.priority)}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{ticket.status_label || getSupportStatusLabel(ticket.status)}</td>
                      <td className="px-5 py-4 text-mapgeo-secondary">{formatDateLabel(ticket.updated_at || ticket.created_at || ticket.date || ticket.lastReply)}</td>
                      <td className="px-5 py-4">{ticket.id ? <Link to={`/support/${ticket.id}`} className="text-sm font-bold text-mapgeo-primary">Ouvrir</Link> : "—"}</td>
                    </tr>
                  )) : null}
                </DetailTable>
              </div>

              <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
                <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">Activité & alertes client</h3>
                <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
                  <InfoSummary icon={Clock3} label="Dernière activité" value={formatDateLabel(client.updated_at || client.created_at)} />
                  <InfoSummary icon={ShieldCheck} label="Portail" value={portalAccessLabel(client)} />
                  <InfoSummary icon={BellRing} label="Alertes" value={`${draftDocuments + criticalTickets + parcelsToVerify} à traiter`} />
                </div>
                <div className="mt-5 space-y-3">
                  {clientAlerts.map((item) => {
                    const content = (
                      <>
                        <span className="h-2.5 w-2.5 rounded-full bg-mapgeo-sand" />
                        <span className="flex-1">{item.label}</span>
                        <ChevronRight size={16} className="text-white/60" />
                      </>
                    );
                    const className = "flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left text-sm font-semibold text-white/90 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50";
                    return item.href ? <Link key={item.label} to={item.href} className={className}>{content}</Link> : <button key={item.label} type="button" onClick={item.onClick} disabled={actionLoading || !client?.primary_user_id} className={className}>{content}</button>;
                  })}
                </div>
              </aside>
            </section>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDeactivateOpen}
        title="Désactiver ce client ?"
        description="Le statut du client passera en inactif et son accès portail principal sera désactivé s’il existe. Cette action ne supprime pas les parcelles ni les documents."
        actionLabel="Désactiver"
        loading={actionLoading}
        onCancel={() => setConfirmDeactivateOpen(false)}
        onConfirm={deactivateClient}
      />
    </DashboardLayout>
  );
}
