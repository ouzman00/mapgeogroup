import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import parcelService from "../../../services/parcelService";
import { getErrorMessage } from "../../../services/responseUtils";

const EMPTY_FIELDS = {
  q: "",
  commune: "",
  client: "",
  title: "",
};

export default function ParcelLookupPanel({ initialValues }) {
  const navigate = useNavigate();
  const [fields, setFields] = useState({ ...EMPTY_FIELDS, ...(initialValues || {}) });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    setFields({ ...EMPTY_FIELDS, ...(initialValues || {}) });
    setMessage("");
    setResults([]);
  }, [initialValues]);

  const isSearchDisabled = useMemo(
    () => !Object.values(fields).some((value) => String(value || "").trim()),
    [fields],
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFields((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setResults([]);

    try {
      const result = await parcelService.getParcels({
        ...(fields.q?.trim() ? { q: fields.q.trim() } : {}),
        ...(fields.commune?.trim() ? { commune: fields.commune.trim() } : {}),
        ...(fields.client?.trim() ? { owner_client_code: fields.client.trim() } : {}),
        ...(fields.title?.trim() ? { title_number: fields.title.trim() } : {}),
        page_size: 6,
      });

      const rows = result.results || [];
      if (!rows.length) {
        setMessage("Aucune parcelle ne correspond à cette recherche.");
        return;
      }

      setResults(rows);
      setMessage(`${rows.length} résultat(s) trouvé(s).`);
    } catch (error) {
      setMessage(getErrorMessage(error, "Recherche impossible pour le moment."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-mapgeo-secondary">Recherche globale</label>
          <input
            name="q"
            value={fields.q}
            onChange={handleChange}
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3"
            placeholder="Référence, section, village..."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-mapgeo-secondary">Commune</label>
            <input
              name="commune"
              value={fields.commune}
              onChange={handleChange}
              className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-mapgeo-secondary">Client</label>
            <input
              name="client"
              value={fields.client}
              onChange={handleChange}
              className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-mapgeo-secondary">Titre / numéro</label>
          <input
            name="title"
            value={fields.title}
            onChange={handleChange}
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || isSearchDisabled}
          className="rounded-2xl bg-mapgeo-primary px-5 py-3 font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "Recherche..." : "Rechercher"}
        </button>
      </form>

      {message ? <p className="text-sm text-mapgeo-secondary">{message}</p> : null}

      {results.length ? (
        <div className="space-y-3">
          {results.map((parcel) => (
            <button
              key={parcel.id}
              type="button"
              onClick={() => navigate(`/parcelles/${parcel.id}/carto`)}
              className="w-full rounded-3xl border border-mapgeo-line bg-white p-4 text-left shadow-soft transition hover:bg-mapgeo-ivory/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-bold text-mapgeo-primary">{parcel.reference}</h4>
                  <p className="mt-1 text-sm text-mapgeo-secondary/75">
                    {parcel.location || parcel.commune || "Sans localisation"}
                  </p>
                </div>
                <span className="rounded-full border border-mapgeo-line px-3 py-1 text-xs font-semibold text-mapgeo-primary">
                  {parcel.owner_client_code || parcel.owner_name || "Client"}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
