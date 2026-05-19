import {
  ArrowLeft,
  Bell,
  CalendarCheck2,
  ChevronDown,
  HelpCircle,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ClientPortfolioMap from "../components/maps/ClientPortfolioMap";
import { getMapConfig } from "../config/mapConfig";
import { getParcelStatusLabel } from "../constants/parcelConstants";
import { canManageBackoffice, getRoleLabel } from "../constants/roleConstants";
import useAuth from "../hooks/useAuth";
import useParcels from "../hooks/useParcels";
import DashboardLayout from "../layouts/DashboardLayout";
import mapLayerService, { toSecureMapLayer } from "../services/mapLayerService";
import geojsonLayerService, { toSecureMapLayer as toSecureLegacyGeoJsonLayer } from "../services/geojsonLayerService";
import parcelService from "../services/parcelService";
import { getErrorMessage, isNotFoundError } from "../services/responseUtils";

const CARTO_SURFACE = "bg-[#0B2236]";
const CARTO_PANEL = "bg-[#0F2D46]/95";
const CARTO_PANEL_SOFT = "bg-[#123B5D]/18";
const CARTO_BORDER = "border-[#C7B299]/20";
const CARTO_TEXT = "text-[#F7F5F2]";
const CARTO_TEXT_MUTED = "text-[#F7F5F2]/65";
const PRIVATE_LAYER_REFRESH_INTERVAL_MS = 30000;

function normalizeLayerText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPrivateMapLayer(layer) {
  return Boolean(layer?.privateLayer) && String(layer?.id || "").startsWith("client-map-layer-");
}

function isLegacyGeoJsonLayer(layer) {
  return Boolean(layer?.privateLayer) && String(layer?.id || "").startsWith("client-geojson-");
}

function privateLayerDedupKey(layer) {
  const name = normalizeLayerText(layer?.name || layer?.shortName || layer?.label);
  if (!name) return "";
  const type = normalizeLayerText(layer?.clientLayerType || layer?.layer_type || layer?.type || layer?.dataFormat || layer?.data_format || layer?.service);
  const group = normalizeLayerText(layer?.group || layer?.metadata?.group || layer?.metadata?.category);
  const owner = normalizeLayerText(layer?.client_id || layer?.clientId || layer?.metadata?.client_id || layer?.metadata?.owner || "client");
  const sourceScope = layer?.privateLayer ? "private" : "public";
  return [sourceScope, owner, name, type, group].join("|");
}

function mergeLayerLists(...layerLists) {
  const merged = new Map();
  const privateKeys = new Map();

  layerLists.flat().forEach((layer) => {
    if (!layer?.id) return;

    const dedupKey = layer?.privateLayer ? privateLayerDedupKey(layer) : "";

    // /geojson-layers/ reste chargé pour compatibilité legacy.
    // On le retire seulement quand une couche privée /map-layers/ a le même nom, type, propriétaire/scope privé et groupe.
    if (dedupKey) {
      const existingId = privateKeys.get(dedupKey);
      const existing = existingId ? merged.get(existingId) : null;

      if (existing && isPrivateMapLayer(existing) && isLegacyGeoJsonLayer(layer)) {
        return;
      }

      if (existing && isLegacyGeoJsonLayer(existing) && isPrivateMapLayer(layer)) {
        merged.delete(existing.id);
      }

      privateKeys.set(dedupKey, layer.id);
    }

    if (!merged.has(layer.id)) merged.set(layer.id, layer);
  });

  return Array.from(merged.values());
}

function StateCard({ tone = "default", message = "" }) {
  const isError = tone === "error";

  if (isError) {
    return (
      <div className={`flex h-full items-center justify-center ${CARTO_SURFACE} p-6`}>
        <div className="w-full max-w-md rounded-[1.5rem] border border-[#C7B299]/45 bg-[#C7B299]/15 px-6 py-5 text-[#F7F5F2] shadow-[0_20px_55px_rgba(0,0,0,0.22)] backdrop-blur">
          <p className="text-sm font-semibold">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full items-center justify-center ${CARTO_SURFACE} p-6`}>
      <div className="relative grid h-20 w-20 place-items-center" aria-label="Chargement" role="status">
        <span className="absolute h-20 w-20 animate-ping rounded-full bg-[#C7B299]/10" />
        <span className="absolute h-16 w-16 rounded-full border border-[#C7B299]/20" />
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#F7F5F2]/20 border-t-[#C7B299]" />
      </div>
    </div>
  );
}

function StatusPill({ parcel }) {
  const label = parcel?.id ? getParcelStatusLabel(parcel.status) : "Mission planifiée";

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#C7B299]/35 bg-[#C7B299]/16 px-3.5 py-2 text-xs font-semibold text-[#F7F5F2] shadow-[inset_0_1px_0_rgba(247,245,242,0.08)]">
      <CalendarCheck2 size={14} className="text-[#C7B299]" /> {label}
    </span>
  );
}

function AppLogo() {
  return (
    <span className="flex min-w-0 items-center gap-3 text-[#F7F5F2]" aria-label="MAPGEO">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-[#C7B299]/25 bg-[#123B5D] shadow-[0_12px_32px_rgba(0,0,0,0.22)]">
        <span className="h-5 w-5 rotate-45 rounded-[5px] border-2 border-[#C7B299] bg-[#C7B299]/20" />
      </span>
      <span className="hidden truncate text-lg font-extrabold tracking-tight md:block">MAPGEO</span>
    </span>
  );
}

function TopIconButton({ icon: Icon, label, to }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-2xl border border-[#C7B299]/18 bg-[#123B5D]/35 text-[#F7F5F2]/78 transition hover:border-[#C7B299]/35 hover:bg-[#123B5D]/55 hover:text-[#F7F5F2]"
    >
      <Icon size={20} />
    </Link>
  );
}

function MapTopbar({ parcel, ownerLabel, user, returnTo = "/parcelles" }) {
  const displayName = user?.full_name || user?.name || user?.email || user?.username || "Utilisateur";
  const role = user?.role_display || getRoleLabel(user?.role);
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";
  // Photo de profil depuis localStorage (même clé que SettingsPage)
  const cartoAvatar = (() => {
    try {
      const key = String(user?.id || user?.username || user?.email || "current-user");
      const stored = window.localStorage.getItem("mapgeo_profile_avatars");
      if (!stored) return "";
      return JSON.parse(stored)?.[key] || "";
    } catch { return ""; }
  })();

  return (
    <header className="mapgeo-carto-topbar flex h-auto min-h-[64px] shrink-0 items-center justify-between border-b border-[#C7B299]/16 bg-[#123B5D]/96 px-3 py-2 text-[#F7F5F2] shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:h-[72px] sm:px-5 sm:py-0">
      <div className="flex min-w-0 items-center gap-5">
        <AppLogo />

        <div className="hidden h-8 w-px bg-[#C7B299]/18 lg:block" />

        <div className="hidden min-w-0 items-center gap-3 md:flex">
          <Link
            to={returnTo || "/parcelles"}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#F7F5F2]/65 transition hover:text-[#F7F5F2]"
          >
            <ArrowLeft size={16} className="text-[#C7B299]" /> Parcelles
          </Link>
          <span className="h-5 w-px bg-[#C7B299]/18" />
          <h1 className="mapgeo-topbar-title truncate text-xl font-extrabold tracking-tight text-[#F7F5F2]">
            {parcel?.reference || parcel?.title_number || "Cartographie"}
          </h1>
          {parcel?.id ? <StatusPill parcel={parcel} /> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden max-w-[220px] truncate rounded-full border border-[#C7B299]/20 bg-[#F7F5F2]/8 px-3 py-2 text-xs font-semibold text-[#F7F5F2]/74 xl:block">
          {ownerLabel || "Carte de travail"}
        </div>

        <TopIconButton icon={Search} label="Rechercher une parcelle" to="/parcelles" />
        <TopIconButton icon={Bell} label="Notifications" to="/notifications" />
        <TopIconButton icon={HelpCircle} label="Aide et support" to="/support" />

        <div className="hidden h-8 w-px bg-[#C7B299]/18 md:block" />

        <Link
          to="/settings"
          className="flex items-center gap-3 rounded-2xl px-2 py-1.5 transition hover:bg-[#F7F5F2]/8"
          aria-label="Ouvrir les paramètres utilisateur"
        >
          <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-[#C7B299]/35 bg-[#F7F5F2] text-sm font-extrabold text-[#123B5D]">
            {cartoAvatar
              ? <img src={cartoAvatar} alt="Avatar" className="h-full w-full object-cover" />
              : initials}
          </span>
          <span className="hidden text-left lg:block">
            <span className="block max-w-[160px] truncate text-sm font-bold text-[#F7F5F2]">{displayName}</span>
            <span className="block max-w-[160px] truncate text-xs text-[#F7F5F2]/55">{role}</span>
          </span>
          <ChevronDown size={17} className="hidden text-[#C7B299] lg:block" />
        </Link>
      </div>
    </header>
  );
}

function simplifyToleranceForZoom(zoom) {
  const numericZoom = Number(zoom);
  if (!Number.isFinite(numericZoom)) return 0;
  if (numericZoom < 10) return 50;
  if (numericZoom < 12) return 25;
  if (numericZoom < 14) return 10;
  return 0;
}

async function fetchBusinessParcels(params = {}) {
  const payload = await parcelService.getParcelMap({
    ...params,
    page_size: params.page_size || 500,
    simplify_tolerance: params.simplify_tolerance ?? simplifyToleranceForZoom(params.zoom),
  });

  return payload.results || [];
}

async function fetchPortfolioParcelsByOwner(ownerClientCode) {
  if (!ownerClientCode) return [];
  return fetchBusinessParcels({ owner_client_code: ownerClientCode });
}

export default function ParcelleCartoPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, isInternalPortal } = useAuth();
  const { fetchOwners, owners } = useParcels();
  const parcelDetailsCacheRef = useRef(new Map());
  const activeParcelRef = useRef(null);
  const loadPortfolioRequestIdRef = useRef(0);
  const loadPortfolioAbortRef = useRef(null);
  const selectionRequestIdRef = useRef(0);

  const [activeParcel, setActiveParcel] = useState(null);
  const [portfolioParcels, setPortfolioParcels] = useState([]);
  const [portfolioOwnerName, setPortfolioOwnerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const canManageParcels = canManageBackoffice(user, isInternalPortal);
  const canArchiveParcels = canManageParcels;
  const canCreateParcels = canManageParcels;

  const selectedOwnerClientCode = searchParams.get("owner_client_code") || searchParams.get("client_code") || "";
  const selectedOrganizationCode = searchParams.get("organization_code") || searchParams.get("client") || "";
  const selectedOrganizationId = searchParams.get("organization_id") || searchParams.get("organization") || "";
  const dashboardMapFilters = useMemo(() => {
    const filters = {
      owner_client_code: selectedOwnerClientCode,
      organization_code: selectedOrganizationCode,
      organization_id: selectedOrganizationId,
      status: searchParams.get("status") || "",
      commune: searchParams.get("commune") || searchParams.get("location") || "",
      period: searchParams.get("period") || "",
      q: searchParams.get("q") || "",
    };

    Object.keys(filters).forEach((key) => {
      if (!filters[key]) delete filters[key];
    });

    return filters;
  }, [searchParams, selectedOrganizationCode, selectedOrganizationId, selectedOwnerClientCode]);
  const returnTo = location.state?.returnTo || searchParams.get("returnTo") || "/parcelles";

  const initialSigLayers = useMemo(() => getMapConfig().sigLayers || [], []);
  const [sigLayers, setSigLayers] = useState(initialSigLayers);

  useEffect(() => {
    activeParcelRef.current = activeParcel;
  }, [activeParcel]);


  useEffect(() => {
    if (!location.state?.openCreate || !canCreateParcels) return;
    setShowCreateDrawer(true);
    navigate(location.pathname + location.search, {
      replace: true,
      state: { ...(location.state || {}), openCreate: false },
    });
  }, [canCreateParcels, location.pathname, location.search, location.state, navigate]);

  const loadMapContextLayers = useCallback(async ({ signal } = {}) => {
    try {
      const privateLayerParams = {
        client_id: selectedOrganizationId,
        client_code: selectedOrganizationCode,
      };
      const hasSelectedClientContext = Boolean(selectedOrganizationId || selectedOrganizationCode);
      const [contextLayers, clientLayers, legacyGeoJsonLayers] = await Promise.all([
        mapLayerService.getLayers().catch((error) => {
          console.warn("Impossible de charger les couches SIG de contexte.", error);
          return [];
        }),
        isInternalPortal && hasSelectedClientContext
          ? mapLayerService.adminListLayers(privateLayerParams).catch((error) => {
              console.warn("Impossible de charger les couches privées du client sélectionné côté interne.", error);
              return [];
            })
          : !isInternalPortal
            ? mapLayerService.getClientLayers().catch((error) => {
                console.warn("Impossible de charger les couches cartographiques privées du client.", error);
                return [];
              })
            : Promise.resolve([]),
        isInternalPortal && hasSelectedClientContext
          ? geojsonLayerService.adminListLayers(privateLayerParams).catch((error) => {
              console.warn("Impossible de charger les anciennes couches GeoJSON privées du client sélectionné côté interne.", error);
              return [];
            })
          : !isInternalPortal
            ? geojsonLayerService.getClientLayers().catch((error) => {
                console.warn("Impossible de charger les anciennes couches GeoJSON privées du client.", error);
                return [];
              })
            : Promise.resolve([]),
      ]);

      if (signal?.cancelled) return;

      const privateLayers = [
        ...clientLayers.map(toSecureMapLayer),
        ...legacyGeoJsonLayers.map(toSecureLegacyGeoJsonLayer),
      ];
      setSigLayers(mergeLayerLists(initialSigLayers, contextLayers, privateLayers));
    } catch (error) {
      console.warn("Impossible de préparer les couches cartographiques.", error);
      if (!signal?.cancelled) setSigLayers(initialSigLayers);
    }
  }, [initialSigLayers, isInternalPortal, selectedOrganizationCode, selectedOrganizationId]);

  useEffect(() => {
    const signal = { cancelled: false };
    const refreshLayers = () => loadMapContextLayers({ signal });

    refreshLayers();
    window.addEventListener("mapgeo:layers:refresh", refreshLayers);

    const intervalId = (!isInternalPortal || selectedOrganizationCode || selectedOrganizationId)
      ? window.setInterval(refreshLayers, PRIVATE_LAYER_REFRESH_INTERVAL_MS)
      : null;

    return () => {
      signal.cancelled = true;
      window.removeEventListener("mapgeo:layers:refresh", refreshLayers);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [isInternalPortal, loadMapContextLayers, selectedOrganizationCode, selectedOrganizationId]);

  useEffect(() => {
    if (canArchiveParcels) {
      fetchOwners().catch(() => {});
    }
  }, [canArchiveParcels, fetchOwners]);

  useEffect(() => {
    let active = true;
    const requestId = loadPortfolioRequestIdRef.current + 1;
    loadPortfolioRequestIdRef.current = requestId;

    if (loadPortfolioAbortRef.current) {
      loadPortfolioAbortRef.current.abort();
    }

    const controller = new AbortController();
    loadPortfolioAbortRef.current = controller;

    const isLatestRequest = () =>
      active &&
      loadPortfolioRequestIdRef.current === requestId &&
      !controller.signal.aborted;

    async function loadPortfolio() {
      // Ne pas afficher de chargement bloquant quand une parcelle est déjà visible.
      // La sélection optimiste reste affichée pendant les chargements de détail.
      setLoading(!activeParcelRef.current);
      setFetchError("");

      try {

        if (!id) {
          const parcels = await fetchBusinessParcels(dashboardMapFilters);
          if (!isLatestRequest()) return;

          setActiveParcel(null);
          setPortfolioOwnerName(selectedOrganizationCode || selectedOwnerClientCode || "Carte de travail");
          setPortfolioParcels(parcels);
          return;
        }

        const parcelId = String(id);
        const cachedDetail = parcelDetailsCacheRef.current.get(parcelId);

        if (cachedDetail) {
          if (!isLatestRequest()) return;

          setActiveParcel(cachedDetail);
          setPortfolioOwnerName(cachedDetail.owner_name || cachedDetail.owner_client_code || portfolioOwnerName || "");
          setPortfolioParcels((current) => {
            const mergedById = new Map();

            [cachedDetail, ...current].forEach((parcel) => {
              if (parcel?.id) mergedById.set(String(parcel.id), parcel);
            });

            return Array.from(mergedById.values());
          });
          return;
        }

        const detail = await parcelService.getParcelById(id);
        if (!isLatestRequest()) return;

        parcelDetailsCacheRef.current.set(String(detail.id), detail);
        setActiveParcel(detail);
        setPortfolioOwnerName(detail.owner_name || detail.owner_client_code || "");

        let portfolio = [detail];

        // Détail admin/manager : on charge uniquement la parcelle active.
        // Le contexte visible est ensuite fourni par /parcelles/map/?bbox=... dans la carte.
        // Client : on conserve le portefeuille autorisé du propriétaire.
        if (!canArchiveParcels && detail.owner_client_code) {
          portfolio = await fetchPortfolioParcelsByOwner(detail.owner_client_code);
          if (!isLatestRequest()) return;
        }

        const mergedById = new Map();

        [detail, ...(Array.isArray(portfolio) ? portfolio : [])].forEach((parcel) => {
          if (parcel?.id) mergedById.set(String(parcel.id), parcel);
        });

        setPortfolioParcels(Array.from(mergedById.values()));
      } catch (error) {
        if (!isLatestRequest()) return;

        if (id && isNotFoundError(error)) {
          setActiveParcel(null);
          setPortfolioParcels([]);
          setPortfolioOwnerName("Carte de travail");
          setFetchError(
            "Parcelle introuvable ou non accessible avec votre compte. La carte générale reste disponible.",
          );
          navigate("/parcelles/carto", { replace: true, state: { returnTo } });
          return;
        }

        setFetchError(getErrorMessage(error, "Erreur lors du chargement de la cartographie."));
      } finally {
        if (isLatestRequest()) setLoading(false);
      }
    }

    loadPortfolio();

    return () => {
      active = false;
      controller.abort();
      if (loadPortfolioAbortRef.current === controller) {
        loadPortfolioAbortRef.current = null;
      }
    };
  }, [id, canArchiveParcels, selectedOrganizationCode, selectedOwnerClientCode, dashboardMapFilters]);

  const handleSelectParcel = async (parcel) => {
    if (!parcel?.id || String(parcel.id) === String(activeParcel?.id)) return;

    const requestId = selectionRequestIdRef.current + 1;
    selectionRequestIdRef.current = requestId;

    const optimisticParcel = portfolioParcels.find((item) => String(item.id) === String(parcel.id)) || parcel;
    const optimisticId = String(optimisticParcel.id);

    // Sélection immédiate : pas de voile de chargement.
    setActiveParcel(optimisticParcel);
    setFetchError("");
    parcelDetailsCacheRef.current.set(optimisticId, optimisticParcel);
    navigate(`/parcelles/${optimisticId}/carto`, { replace: true, state: { returnTo } });

    try {
      const detail = await parcelService.getParcelById(optimisticId);

      // Si une autre parcelle a été sélectionnée entre-temps, on ignore cette ancienne réponse.
      if (selectionRequestIdRef.current !== requestId) return;

      parcelDetailsCacheRef.current.set(String(detail.id), detail);
      setActiveParcel(detail);
      setPortfolioOwnerName(detail.owner_name || detail.owner_client_code || portfolioOwnerName);

      setPortfolioParcels((current) => {
        const mergedById = new Map();

        [detail, ...current].forEach((item) => {
          if (!item?.id) return;

          const key = String(item.id);
          const existing = mergedById.get(key) || {};

          mergedById.set(
            key,
            key === String(detail.id)
              ? { ...existing, ...item, ...detail }
              : { ...existing, ...item },
          );
        });

        return Array.from(mergedById.values());
      });
    } catch (error) {
      if (selectionRequestIdRef.current !== requestId) return;

      if (isNotFoundError(error)) {
        setActiveParcel(null);
        setFetchError("Parcelle introuvable ou non accessible avec votre compte.");
        navigate("/parcelles/carto", { replace: true, state: { returnTo } });
      } else {
        setFetchError(getErrorMessage(error, "Impossible de charger cette parcelle."));
      }
    }
  };

  const handleParcelUpdated = async (savedParcel) => {
    if (!savedParcel?.id) return;

    const previousActive = activeParcel && String(activeParcel.id) === String(savedParcel.id) ? activeParcel : null;

    const hasGeometry = Object.prototype.hasOwnProperty.call(savedParcel, "geometry");
    const hasCoordinatesText = Object.prototype.hasOwnProperty.call(savedParcel, "coordinates_text");
    const nextActiveParcel = {
      ...(previousActive || {}),
      ...savedParcel,
      geometry: hasGeometry ? savedParcel.geometry : previousActive?.geometry,
      coordinates_text: hasCoordinatesText ? savedParcel.coordinates_text : previousActive?.coordinates_text,
    };

    setActiveParcel(nextActiveParcel);

    setPortfolioParcels((current) => {
      const mergedById = new Map();

      [nextActiveParcel, ...current].forEach((parcel) => {
        if (!parcel?.id) return;
        const key = String(parcel.id);
        const existing = mergedById.get(key) || {};
        mergedById.set(
          key,
          key === String(nextActiveParcel.id)
            ? { ...existing, ...parcel, ...nextActiveParcel }
            : { ...existing, ...parcel },
        );
      });

      return Array.from(mergedById.values());
    });
  };

  const handleParcelDeleted = async (parcelId) => {
    if (!parcelId) return;

    const nextPortfolio = portfolioParcels.filter((parcel) => String(parcel.id) !== String(parcelId));
    setPortfolioParcels(nextPortfolio);

    if (activeParcel && String(activeParcel.id) === String(parcelId)) {
      const nextActive = nextPortfolio[0] || null;
      setActiveParcel(nextActive);
      navigate(nextActive?.id ? `/parcelles/${nextActive.id}/carto` : "/parcelles/carto", { replace: true, state: { returnTo } });
    }
  };

  const refreshPortfolio = async (targetParcelId) => {
    if (targetParcelId) {
      let detail;
      try {
        detail = await parcelService.getParcelById(targetParcelId);
      } catch (error) {
        if (isNotFoundError(error)) {
          setActiveParcel(null);
          setFetchError("Parcelle introuvable ou non accessible avec votre compte.");
          navigate("/parcelles/carto", { replace: true, state: { returnTo } });
          return;
        }
        throw error;
      }

      setActiveParcel(detail);

      if (!canArchiveParcels && detail.owner_client_code) {
        const nextPortfolio = await fetchPortfolioParcelsByOwner(detail.owner_client_code);
        const mergedById = new Map();

        [detail, ...(Array.isArray(nextPortfolio) ? nextPortfolio : [])].forEach((parcel) => {
          if (parcel?.id) mergedById.set(String(parcel.id), parcel);
        });

        setPortfolioParcels(Array.from(mergedById.values()));
      } else {
        setPortfolioParcels((current) => {
          const mergedById = new Map();

          [detail, ...current].forEach((parcel) => {
            if (parcel?.id) mergedById.set(String(parcel.id), parcel);
          });

          return Array.from(mergedById.values());
        });
      }

      navigate(`/parcelles/${detail.id}/carto`, { replace: true, state: { returnTo } });
      return;
    }

    if (activeParcel?.owner_client_code) {
      const nextPortfolio = await fetchPortfolioParcelsByOwner(activeParcel.owner_client_code);
      setPortfolioParcels(nextPortfolio);
      return;
    }

    const parcels = await fetchBusinessParcels();
    setPortfolioParcels(parcels);
  };

  const ownerLabel = activeParcel?.owner_name || activeParcel?.owner_client_code || portfolioOwnerName || "Carte de travail";

  if (loading && !activeParcel) {
    return (
      <DashboardLayout immersive>
        <StateCard />
      </DashboardLayout>
    );
  }

  if (fetchError && !activeParcel) {
    return (
      <DashboardLayout immersive>
        <StateCard message={fetchError} tone="error" />
      </DashboardLayout>
    );
  }

  if (id && !activeParcel) {
    return (
      <DashboardLayout immersive>
        <StateCard message="Parcelle introuvable." tone="error" />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout immersive>
      <div className="mapgeo-carto-page mapgeo-carto-workspace flex h-full min-h-0 w-full max-w-none flex-col overflow-hidden bg-[#0B2236] text-[#F7F5F2]">
        <MapTopbar parcel={activeParcel} ownerLabel={ownerLabel} user={user} returnTo={returnTo} />

        <div className="mapgeo-carto-body flex min-h-0 flex-1 overflow-hidden bg-[#0B2236]">
          <div className="relative min-w-0 flex-1 overflow-hidden">
                        <ClientPortfolioMap
              clientCode={activeParcel?.owner_client_code}
              ownerName={portfolioOwnerName || activeParcel?.owner_name}
              parcels={portfolioParcels}
              activeParcel={activeParcel}
              sigLayers={sigLayers}
              onSelectParcel={handleSelectParcel}
              defaultViewMode={portfolioParcels.length > 1 ? "portfolio" : "selection"}

              canManageParcels={canManageParcels}
              canArchiveParcels={canArchiveParcels}
              canCreateParcel={canCreateParcels}
              onCreateParcel={canCreateParcels ? () => setShowCreateDrawer(true) : undefined}
              createParcelActive={showCreateDrawer && canCreateParcels}
              createParcelOwners={canArchiveParcels ? owners : []}
              createParcelDefaultOwnerId={canArchiveParcels ? activeParcel?.owner : null}
              onCancelCreateParcel={() => setShowCreateDrawer(false)}

              onParcelCreated={async (newParcel) => {
                if (!canCreateParcels) return;
                setShowCreateDrawer(false);
                if (newParcel?.id) {
                  await refreshPortfolio(newParcel.id);
                }
              }}
              onParcelUpdated={canManageParcels ? handleParcelUpdated : undefined}
              onParcelDeleted={canArchiveParcels ? handleParcelDeleted : undefined}
              mapFilters={dashboardMapFilters}
            />





            {fetchError ? (
              <div className="absolute bottom-6 left-6 z-[1100] max-w-md rounded-2xl border border-[#C7B299]/35 bg-[#C7B299]/15 px-4 py-3 text-sm text-[#F7F5F2] shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur">
                {fetchError}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
