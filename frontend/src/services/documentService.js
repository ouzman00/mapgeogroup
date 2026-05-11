import api, { fetchAllPages } from "./api";
import { normalizeListResponse } from "./responseUtils";

const documentService = {
  async getDocuments(params = {}) {
    const response = await api.get("/documents/", { params });
    return normalizeListResponse(response.data);
  },

  async getAllDocuments(params = {}) {
    const data = await fetchAllPages("/documents/", params);
    return normalizeListResponse(data);
  },

  async getDocumentById(id) {
    const response = await api.get(`/documents/${id}/`);
    return response.data;
  },

  async createDocument(formData) {
    const response = await api.post("/documents/", formData);
    return response.data;
  },

  async updateDocument(id, payload) {
    const response = await api.patch(`/documents/${id}/`, payload);
    return response.data;
  },

  async downloadDocument(id) {
    const response = await api.get(`/documents/${id}/download/`, { responseType: "blob" });
    return response.data;
  },

  async deleteDocument(id) {
    const response = await api.delete(`/documents/${id}/`);
    return response.data;
  },

  async deleteDocuments(ids = []) {
    const response = await api.post("/documents/delete-selected/", { ids });
    return response.data;
  },
};

export default documentService;
