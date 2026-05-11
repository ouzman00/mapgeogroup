import api, { fetchAllPages } from "./api";
import { normalizeListResponse } from "./responseUtils";

const supportService = {
  async getTickets(params = {}) {
    const response = await api.get("/support/", { params });
    return normalizeListResponse(response.data);
  },

  async getAllTickets(params = {}) {
    const data = await fetchAllPages("/support/", params);
    return normalizeListResponse(data);
  },

  async createTicket(payload) {
    const response = await api.post("/support/", payload);
    return response.data;
  },

  async getTicketById(id) {
    const response = await api.get(`/support/${id}/`);
    return response.data;
  },

  async updateTicket(id, payload) {
    const response = await api.patch(`/support/${id}/`, payload);
    return response.data;
  },

  async deleteTicket(id) {
    const response = await api.delete(`/support/${id}/`);
    return response.data;
  },

  async deleteTickets(ids = []) {
    const response = await api.post("/support/delete-selected/", { ids });
    return response.data;
  },

  async replyToTicket(id, payload) {
    const data = payload instanceof FormData
      ? payload
      : { body: payload?.body || payload?.message || "", is_internal_note: Boolean(payload?.is_internal_note) };
    const response = await api.post(`/support/${id}/reply/`, data);
    return response.data;
  },

  async deleteMessage(messageId) {
    const response = await api.delete(`/support/messages/${messageId}/`);
    return response.data;
  },

  async closeTicket(id) {
    const response = await api.post(`/support/${id}/close/`);
    return response.data;
  },

  async resolveTicket(id) {
    const response = await api.post(`/support/${id}/resolve/`);
    return response.data;
  },

  async reopenTicket(id) {
    const response = await api.post(`/support/${id}/reopen/`);
    return response.data;
  },

  async startTicket(id) {
    const response = await api.post(`/support/${id}/start/`);
    return response.data;
  },

  async escalateTicket(id) {
    const response = await api.post(`/support/${id}/escalate/`);
    return response.data;
  },

  async downloadAttachment(messageId) {
    const response = await api.get(`/support/messages/${messageId}/attachment/`, { responseType: "blob" });
    return response.data;
  },
};

export default supportService;
