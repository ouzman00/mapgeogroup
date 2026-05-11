import api, { getDeduped } from "./api";

const authService = {
  async login(credentials = {}) {
    // On force le bon format attendu par l'API.
    const payload = {
      login: String(credentials.login || credentials.username || credentials.identifier || "").trim(),
      password: credentials.password || "",
    };

    const response = await api.post("/accounts/login/", payload);
    return response.data;
  },

  async getProfile() {
    const response = await getDeduped("/accounts/profile/");
    return response.data;
  },

  async logout() {
    const response = await api.post("/accounts/logout/");
    return response.data;
  },

  async updateProfile(payload) {
    const response = await api.patch("/accounts/profile/", payload);
    return response.data;
  },

  async changePassword(payload) {
    const response = await api.post("/accounts/change-password/", payload);
    return response.data;
  },

  async forgotPassword(payload = {}) {
    const identifier = String(
      payload.identifier || payload.login || payload.email || "",
    ).trim();

    const response = await api.post("/accounts/forgot-password/", { identifier });
    return response.data;
  },

  async validateResetPassword(uid, token) {
    const response = await api.get(`/accounts/reset-password/${uid}/${token}/`);
    return response.data;
  },

  async resetPassword(payload) {
    const response = await api.post("/accounts/reset-password/confirm/", payload);
    return response.data;
  },

  async googleLogin(credential) {
    const response = await api.post("/accounts/google/login/", { credential });
    return response.data;
  },
};

export default authService;
