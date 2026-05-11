import { getDeduped } from "./api";

const dashboardService = {
  async getStats() {
    const response = await getDeduped("/dashboard/");
    return response.data;
  },
};

export default dashboardService;
