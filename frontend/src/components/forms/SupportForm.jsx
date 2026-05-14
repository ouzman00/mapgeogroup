import { useCallback, useEffect, useMemo, useState } from "react";
import supportService from "../../services/supportService";
import { LoadingInline } from "../ui/LoadingState";
import useAuth from "../../hooks/useAuth";
import useParcelSearch, { formatParcelOptionLabel } from "../../hooks/useParcelSearch";
import { getErrorMessage } from "../../services/responseUtils";
import { SUPPORT_ATTACHMENT_FORMATS_LABEL, SUPPORT_ATTACHMENT_MAX_SIZE_LABEL } from "../../constants/supportConstants";

const EMPTY_FORM = {
  subject: "",
  priority: "medium",
  parcel: "",
  message: "",
};

const priorityLabels = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  urgent: "Urgente",
};

const statusLabels = {
  open: "Ouvert",
  in_progress: "En cours",
  resolved: "Résolu",
  closed: "Clos",
};

export default function SupportForm() {
  const { isClientPortal, isInternalPortal } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [tickets, setTickets] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const {
    parcels,
    loading: parcelsLoading,
    error: parcelsError,
    query: parcelQuery,
    setQuery: setParcelQuery,
  } = useParcelSearch({
    selectedParcelId: form.parcel,
    pageSize: 50,
    debounceMs: 300,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const ticketData = await supportService.getAllTickets({ ...(statusFilter ? { status: statusFilter } : {}) });
      setTickets(ticketData.results);
    } catch (error) {
      console.error(error);
      setMessage(getErrorMessage(error, "Impossible de charger les données support."));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    try {
      if (!form.subject.trim() || !form.message.trim()) {
        setMessage("Le sujet et le message sont obligatoires.");
        return;
      }

      const payload = {
        subject: form.subject.trim(),
        priority: form.priority,
        message: form.message.trim(),
      };
      if (form.parcel) payload.parcel = form.parcel;

      await supportService.createTicket(payload);
      setForm(EMPTY_FORM);
      setMessage("Demande envoyée avec succès.");
      await loadData();
    } catch (error) {
      console.error(error);
      setMessage(getErrorMessage(error, "Impossible d’envoyer la demande."));
    } finally {
      setSubmitting(false);
    }
  };

  const recentTickets = useMemo(
    () => tickets.slice(0, isClientPortal ? 4 : 8),
    [tickets, isClientPortal],
  );

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            name="subject"
            value={form.subject}
            onChange={handleChange}
            disabled={submitting}
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Sujet"
            required
          />
          <select
            name="priority"
            value={form.priority}
            onChange={handleChange}
            disabled={submitting}
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="low">Faible</option>
            <option value="medium">Moyenne</option>
            <option value="high">Élevée</option>
            {isInternalPortal ? <option value="urgent">Urgente</option> : null}
          </select>
        </div>

        <div className="space-y-2">
          <input
            value={parcelQuery}
            onChange={(event) => setParcelQuery(event.target.value)}
            disabled={submitting}
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Rechercher par référence, client ou commune"
          />
          <div className="min-h-[1rem] text-xs font-semibold text-mapgeo-secondary">
            {parcelsLoading ? "Recherche des parcelles…" : null}
            {!parcelsLoading && parcelsError ? <span className="text-red-600">{parcelsError}</span> : null}
            {!parcelsLoading && !parcelsError && parcels.length ? `${parcels.length} parcelle(s) proposée(s)` : null}
          </div>
        </div>

        <select
          name="parcel"
          value={form.parcel}
          onChange={handleChange}
          disabled={submitting}
          className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">Choisir une parcelle</option>
          {parcels.map((parcel) => (
            <option key={parcel.id} value={parcel.id}>{formatParcelOptionLabel(parcel)}</option>
          ))}
        </select>

        <textarea
          name="message"
          value={form.message}
          onChange={handleChange}
          rows="6"
          disabled={submitting}
          className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Décrivez votre demande"
          required
        />

        <p className="text-xs text-mapgeo-secondary/70">
          Pièces jointes support : {SUPPORT_ATTACHMENT_FORMATS_LABEL} · limite {SUPPORT_ATTACHMENT_MAX_SIZE_LABEL}. Les fichiers sont transmis via une route sécurisée.
        </p>

        <button
          disabled={submitting}
          className="rounded-2xl bg-mapgeo-primary text-white px-6 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Envoi…" : "Envoyer la demande"}
        </button>
      </form>

      {message ? <div className="text-sm text-mapgeo-secondary">{message}</div> : null}

      <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/40 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h4 className="font-bold text-mapgeo-primary text-lg">Demandes récentes</h4>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="mt-3">
            <LoadingInline label="Veuillez patienter" />
          </div>
        ) : null}
        {!loading && !recentTickets.length ? <p className="text-mapgeo-secondary mt-3">Aucune demande enregistrée.</p> : null}
        <div className="space-y-3 mt-4">
          {recentTickets.map((ticket) => (
            <div key={ticket.id} className="rounded-2xl bg-white border border-mapgeo-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h5 className="font-semibold text-mapgeo-primary">{ticket.subject}</h5>
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs font-semibold rounded-full bg-mapgeo-primary/10 text-mapgeo-primary px-3 py-1 border border-mapgeo-line">
                    {priorityLabels[ticket.priority] || ticket.priority}
                  </span>
                  <span className="text-xs font-semibold rounded-full bg-white text-mapgeo-primary px-3 py-1 border border-mapgeo-line">
                    {statusLabels[ticket.status] || ticket.status}
                  </span>
                </div>
              </div>
              <p className="text-sm text-mapgeo-secondary mt-2">{ticket.message}</p>
              <p className="text-xs text-mapgeo-secondary/70 mt-2">
                {ticket.parcel_reference ? `Parcelle ${ticket.parcel_reference} · ` : ""}
                {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString("fr-FR") : "Date inconnue"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
