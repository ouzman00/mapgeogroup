import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import parcelService from "../services/parcelService";
import { getErrorMessage } from "../services/responseUtils";

function normalizeQuery(value) {
  return String(value || "").trim();
}

function parcelKey(parcel) {
  return String(parcel?.id || "");
}

export function formatParcelOptionLabel(parcel) {
  if (!parcel) return "Parcelle";

  const reference = parcel.reference || parcel.title_number || parcel.parcel_number || `Parcelle ${parcel.id}`;
  const client = parcel.owner_client_code || parcel.owner_name || parcel.client_name || null;
  const commune = parcel.commune || parcel.location || parcel.village || null;

  return [reference, client, commune].filter(Boolean).join(" · ");
}

export default function useParcelSearch({
  initialQuery = "",
  selectedParcelId = "",
  pageSize = 50,
  debounceMs = 300,
  refreshKey = 0,
} = {}) {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [debounceMs, query]);

  const refresh = useCallback(() => {
    setLocalRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    async function loadParcels() {
      setLoading(true);
      setError("");

      try {
        const search = normalizeQuery(debouncedQuery);
        const payload = await parcelService.searchParcels({
          ...(search ? { q: search } : {}),
          page_size: pageSize,
        });

        let nextParcels = payload.results || [];

        if (selectedParcelId && !nextParcels.some((parcel) => parcelKey(parcel) === String(selectedParcelId))) {
          try {
            const selectedParcel = await parcelService.getParcelById(selectedParcelId);
            if (selectedParcel?.id) nextParcels = [selectedParcel, ...nextParcels];
          } catch {
            // La parcelle sélectionnée peut ne plus être accessible : on garde les résultats de recherche.
          }
        }

        if (active && requestSeq === requestSeqRef.current) {
          const deduped = new Map();
          nextParcels.forEach((parcel) => {
            if (parcel?.id) deduped.set(String(parcel.id), parcel);
          });
          setParcels(Array.from(deduped.values()));
        }
      } catch (loadError) {
        if (active && requestSeq === requestSeqRef.current) {
          setParcels([]);
          setError(getErrorMessage(loadError, "Impossible de charger les parcelles."));
        }
      } finally {
        if (active && requestSeq === requestSeqRef.current) setLoading(false);
      }
    }

    loadParcels();

    return () => {
      active = false;
    };
  }, [debouncedQuery, pageSize, refreshKey, localRefreshKey, selectedParcelId]);

  const hasExactSelection = useMemo(
    () => Boolean(selectedParcelId && parcels.some((parcel) => parcelKey(parcel) === String(selectedParcelId))),
    [parcels, selectedParcelId],
  );

  return {
    query,
    setQuery,
    debouncedQuery,
    parcels,
    loading,
    error,
    refresh,
    hasExactSelection,
  };
}
