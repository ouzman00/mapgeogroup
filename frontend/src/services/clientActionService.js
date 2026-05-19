import api from "./api";
import { normalizeListResponse } from "./responseUtils";

const clientActionService = {
  async getActions(params = {}) {
    const response = await api.get("/client-actions/", { params });
    return normalizeListResponse(response.data).results;
  },

  async getOpenActions(params = {}) {
    return this.getActions({ ...params, status: "open" });
  },

  async completeAction(actionId) {
    const response = await api.patch(`/client-actions/${actionId}/complete/`);
    return response.data;
  },
};

export default clientActionService;
