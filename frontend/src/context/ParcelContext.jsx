import { createContext, useCallback, useMemo, useState } from "react";
import parcelService from "../services/parcelService";

export const ParcelContext = createContext(null);

export function ParcelProvider({ children }) {
  const [parcels, setParcels] = useState([]);
  const [selectedParcel, setSelectedParcel] = useState(null);
  const [owners, setOwners] = useState([]);
  const [listMeta, setListMeta] = useState({ count: 0, next: null, previous: null });
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);

  const fetchParcels = useCallback(async (params = {}) => {
    setLoadingList(true);
    try {
      const payload = await parcelService.getParcels({
        page: 1,
        page_size: 100,
        ...params,
      });
      setParcels(payload.results);
      setListMeta({ count: payload.count, next: payload.next, previous: payload.previous });
      return payload;
    } catch (error) {
      console.error("Erreur chargement parcelles:", error);
      throw error;
    } finally {
      setLoadingList(false);
    }
  }, []);

  const fetchParcelById = useCallback(async (id) => {
    setLoadingDetail(true);
    try {
      const data = await parcelService.getParcelById(id);
      setSelectedParcel(data);
      return data;
    } catch (error) {
      setSelectedParcel(null);
      console.error("Erreur chargement détail parcelle:", error);
      throw error;
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const fetchOwners = useCallback(async (params = {}) => {
    setLoadingOwners(true);
    try {
      const rows = await parcelService.getOwners(params);
      setOwners(rows);
      return rows;
    } catch (error) {
      console.error("Erreur chargement propriétaires:", error);
      throw error;
    } finally {
      setLoadingOwners(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      parcels,
      listMeta,
      selectedParcel,
      owners,
      loading: loadingList || loadingDetail || loadingOwners,
      loadingList,
      loadingDetail,
      loadingOwners,
      fetchParcels,
      fetchParcelById,
      fetchOwners,
      setSelectedParcel,
    }),
    [
      parcels,
      listMeta,
      selectedParcel,
      owners,
      loadingList,
      loadingDetail,
      loadingOwners,
      fetchParcels,
      fetchParcelById,
      fetchOwners,
    ],
  );

  return <ParcelContext.Provider value={value}>{children}</ParcelContext.Provider>;
}
