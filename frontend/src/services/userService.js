import api, { fetchAllPages } from "./api";
import { normalizeListResponse } from "./responseUtils";

const userService = {
  async getUsers(params = {}) {
    const response = await api.get("/accounts/users/", { params });
    return normalizeListResponse(response.data);
  },

  async getAllUsers(params = {}) {
    const data = await fetchAllPages("/accounts/users/", params);
    return normalizeListResponse(data);
  },

  async inviteUser(payload) {
    const response = await api.post("/accounts/users/invite/", payload);
    return response.data;
  },

  async updateUser(id, payload) {
    const response = await api.patch(`/accounts/users/${id}/`, payload);
    return response.data;
  },

  async resetAccess(id) {
    const response = await api.post(`/accounts/users/${id}/reset-access/`);
    return response.data;
  },

  async activateUser(id) {
    const response = await api.post(`/accounts/users/${id}/activate/`);
    return response.data;
  },

  async deactivateUser(id) {
    const response = await api.post(`/accounts/users/${id}/deactivate/`);
    return response.data;
  },
};

export default userService;
