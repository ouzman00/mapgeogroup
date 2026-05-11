import api, { getDeduped } from "./api";
import { normalizeListResponse } from "./responseUtils";

function normalizeNotificationPayload(data) {
  const normalized = normalizeListResponse(data);
  return {
    ...normalized,
    unread_count: Number(data?.unread_count ?? normalized.results.filter((item) => !item.is_read).length),
    total_count: Number(data?.total_count ?? normalized.count ?? normalized.results.length),
  };
}

const notificationService = {
  async getNotifications({ pageSize = 200 } = {}) {
    const response = await getDeduped("/notifications/", { params: { page_size: pageSize } });
    return normalizeNotificationPayload(response.data);
  },

  async markAsRead(id) {
    const response = await api.post(`/notifications/${id}/read/`);
    return response.data;
  },

  async markAllAsRead() {
    const response = await api.post("/notifications/read-all/");
    return response.data;
  },

  async deleteNotification(id) {
    const response = await api.delete(`/notifications/${id}/`);
    return response.data;
  },

  async deleteNotifications(ids = []) {
    const response = await api.post("/notifications/delete-selected/", { ids });
    return response.data;
  },
};

export default notificationService;
