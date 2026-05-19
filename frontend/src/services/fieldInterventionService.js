import api from "./api";
import { normalizeListResponse } from "./responseUtils";

const fieldInterventionService = {
  async getInterventions(params = {}) {
    const response = await api.get("/field-interventions/", { params });
    return normalizeListResponse(response.data).results;
  },

  async getParcelInterventions(parcelId) {
    if (!parcelId) return [];
    return this.getInterventions({ parcel: parcelId });
  },
};

export default fieldInterventionService;
