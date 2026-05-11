export function normalizeListResponse(data) {
  if (Array.isArray(data)) {
    return {
      count: data.length,
      next: null,
      previous: null,
      results: data,
    };
  }

  if (Array.isArray(data?.results)) {
    return {
      count: Number(data.count ?? data.results.length),
      next: data.next ?? null,
      previous: data.previous ?? null,
      results: data.results,
    };
  }

  return {
    count: 0,
    next: null,
    previous: null,
    results: [],
  };
}

export function normalizeListPayload(data) {
  return normalizeListResponse(data).results;
}

export function isNotFoundError(error) {
  return Number(error?.response?.status) === 404;
}

function humanizeErrorField(field) {
  const labels = {
    reference: "Référence",
    owner: "Client",
    location: "Localisation",
    commune: "Commune",
    status: "Statut",
    area: "Surface",
    latitude: "Y / Northing (m)",
    longitude: "X / Easting (m)",
    geometry: "Géométrie",
    coordinates_text: "Coordonnées",
    non_field_errors: "Erreur",
  };

  return labels[field] || field;
}

function flattenPayloadError(value) {
  if (typeof value === "string") return value.trim();

  if (Array.isArray(value)) {
    return value
      .map((item) => flattenPayloadError(item))
      .filter(Boolean)
      .join(" ");
  }

  if (value && typeof value === "object") {
    const entry = Object.entries(value)
      .map(([field, fieldValue]) => {
        const message = flattenPayloadError(fieldValue);
        return message ? `${humanizeErrorField(field)} : ${message}` : "";
      })
      .find(Boolean);

    return entry || "";
  }

  return "";
}

function isAuthTokenError(error, payload) {
  const status = Number(error?.response?.status);
  const text = [
    typeof payload === "string" ? payload : "",
    typeof payload?.detail === "string" ? payload.detail : "",
    typeof payload?.code === "string" ? payload.code : "",
    typeof error?.message === "string" ? error.message : "",
  ]
    .join(" ")
    .toLowerCase();

  return (
    status === 401 ||
    text.includes("token") ||
    text.includes("jeton") ||
    text.includes("credentials") ||
    text.includes("authentification")
  );
}

function isPublicAuthRequest(error) {
  const url = String(error?.config?.url || "");

  return (
    url.includes("/accounts/login/") ||
    url.includes("/accounts/register/") ||
    url.includes("/accounts/forgot-password/") ||
    url.includes("/accounts/reset-password/") ||
    url.includes("/accounts/clients/activation/") ||
    url.includes("/accounts/google/login/")
  );
}

export function getErrorMessage(error, fallback = "Une erreur est survenue.") {
  const payload = error?.response?.data;

  if (isAuthTokenError(error, payload) && !isPublicAuthRequest(error)) {
    return "Votre session a expiré. Veuillez vous reconnecter.";
  }

  if (typeof payload?.detail === "string" && payload.detail.trim()) {
    return payload.detail.trim();
  }

  if (isNotFoundError(error)) {
    return "Ressource introuvable.";
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  if (payload && typeof payload === "object") {
    const payloadMessage = flattenPayloadError(payload);
    if (payloadMessage) return payloadMessage;
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}
