import { useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { PARCEL_STATUS_OPTIONS } from "../../constants/parcelConstants";

export default function ParcelFilterForm({ values, onSubmit, onReset, loading = false }) {
  const [draftValues, setDraftValues] = useState(values);

  useEffect(() => {
    setDraftValues(values);
  }, [values]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setDraftValues((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(draftValues);
  };

  const handleReset = () => {
    const empty = { q: "", location: "", status: "" };
    setDraftValues(empty);
    onReset?.();
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl bg-white border border-mapgeo-line shadow-soft p-5 mb-5">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr_0.9fr_auto_auto] gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-mapgeo-secondary mb-2">Recherche globale</label>
          <div className="flex items-center gap-3 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3">
            <Search size={18} className="text-mapgeo-secondary/50" />
            <input
              name="q"
              value={draftValues.q}
              onChange={handleChange}
              placeholder="Référence, client, commune, section..."
              className="w-full bg-transparent outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-mapgeo-secondary mb-2">Localisation</label>
          <input
            name="location"
            value={draftValues.location}
            onChange={handleChange}
            placeholder="Commune, village, zone..."
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-mapgeo-secondary mb-2">Statut</label>
          <select
            name="status"
            value={draftValues.status}
            onChange={handleChange}
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 outline-none"
          >
            <option value="">Tous les statuts</option>
            {PARCEL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-mapgeo-primary text-white px-5 py-3 font-semibold inline-flex items-center gap-2 justify-center disabled:opacity-60"
        >
          <SlidersHorizontal size={18} /> {loading ? "Filtrage..." : "Filtrer"}
        </button>

        <button
          type="button"
          onClick={handleReset}
          className="rounded-2xl border border-mapgeo-line px-5 py-3 font-semibold text-mapgeo-primary inline-flex items-center gap-2 justify-center"
        >
          <X size={18} /> Réinitialiser
        </button>
      </div>
    </form>
  );
}
