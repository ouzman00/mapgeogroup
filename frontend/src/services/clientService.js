import api, { fetchAllPages } from "./api";
import { normalizeListResponse } from "./responseUtils";

const CLIENTS_ENDPOINT = "/organizations/";
const COMPLETE_CLIENT_ENDPOINT = "/accounts/clients/";

export async function fetchClients(params = {}) {
  const response = await api.get(CLIENTS_ENDPOINT, {
    params: { organization_type: "client", ...params },
  });
  return normalizeListResponse(response.data);
}

export async function fetchAllClients(params = {}) {
  const data = await fetchAllPages(CLIENTS_ENDPOINT, { organization_type: "client", ...params });
  return normalizeListResponse(data);
}

export async function fetchClientById(id) {
  if (!id) throw new Error("Identifiant client manquant.");
  const response = await api.get(`${CLIENTS_ENDPOINT}${id}/`);
  return response.data;
}

export async function createClient(payload) {
  const response = await api.post(COMPLETE_CLIENT_ENDPOINT, payload);
  return response.data;
}

export async function updateClient(id, payload) {
  const response = await api.patch(`${CLIENTS_ENDPOINT}${id}/`, payload);
  return response.data;
}

export async function deleteClient(id) {
  await api.delete(`${CLIENTS_ENDPOINT}${id}/`);
}

export async function resetClientAccess(userId) {
  const response = await api.post(`/accounts/users/${userId}/reset-access/`);
  return response.data;
}

export async function activateUser(userId) {
  const response = await api.post(`/accounts/users/${userId}/activate/`);
  return response.data;
}

export async function deactivateUser(userId) {
  const response = await api.post(`/accounts/users/${userId}/deactivate/`);
  return response.data;
}

export async function validateClientActivation(uid, token) {
  const response = await api.get(
    `/accounts/clients/activation/${uid}/${token}/`,
  );
  return response.data;
}

export async function confirmClientActivation(payload) {
  const response = await api.post(
    "/accounts/clients/activation/confirm/",
    payload,
  );
  return response.data;
}