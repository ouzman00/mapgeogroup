import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useProfessionalLayers from "./pro/useProfessionalLayers";
import PrintMapDialog from "./pro/PrintMapDialog";
import PortfolioSidebar from "./portfolio/PortfolioSidebar";
import PortfolioMapShell from "./portfolio/PortfolioMapShell";
import PortfolioInspector from "./portfolio/PortfolioInspector";
import usePortfolioFeatures from "./portfolio/usePortfolioFeatures";
import parcelService from "../../services/parcelService";
import { lngLatToSenegalProjected } from "../../utils/parcelGeometry";

function simplifyToleranceForZoom(zoom) {
  const numericZoom = Number(zoom);
  if (!Number.isFinite(numericZoom)) return 0;

  // Parcellaire : privilégier la stabilité visuelle.
  // Une simplification forte change la forme au zoom et donne l'impression
  // que les parcelles se décollent du fond de carte.
  if (numericZoom < 9) return 8;
  if (numericZoom < 11) return 4;
  if (numericZoom < 13) return 2;
  return 0;
}

function roundBboxValue(value, gridSize = 25) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round(numericValue / gridSize) * gridSize;
}

function getHttpStatus(error) {
  return Number(
    error?.response?.status ||
      error?.status ||
      error?.request?.status ||
      0,
  );
}

function isAccessError(error) {
  const status = getHttpStatus(error);
  return status === 401 || status === 403;
}

function getAccessErrorMessage(error) {
  const status = getHttpStatus(error);

  if (status === 401) {
    return "Session expirée. Veuillez vous reconnecter.";
  }

  if (status === 403) {
    return "Accès refusé ou session expirée. Veuillez vérifier votre connexion.";
  }

  return "Impossible de charger les données cartographiques.";
}

export default function ClientPortfolioMap({
  clientCode,
  ownerName,
  parcels,
  activeParcel,
  sigLayers = [],
  onSelectParcel,
  defaultViewMode = "selection",
  canManageParcels = false,
  canArchiveParcels = false,
  canCreateParcel = false,
  onCreateParcel,
  createParcelActive = false,
  createParcelOwners = [],
  createParcelDefaultOwnerId = null,
  onCancelCreateParcel,
  onParcelCreated,
  onParcelUpdated,
  onParcelDeleted,
  mapFilters = {},
}) {
  const mapContainerRef = useRef(null);

  const [mobilePanel, setMobilePanel] = useState("map");

  const [map, setMap] = useState(null);
  const [mapZoom, setMapZoom] = useState(16);
  const [cursorPosition, setCursorPosition] = useState(null);

  const [showVertices, setShowVertices] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showLegend, setShowLegend] = useState(() => {
    // Premier affichage : legende ouverte automatiquement pour aider l utilisateur
    // a comprendre le code couleur des statuts. Le choix utilisateur est memorise
    // pour la session courante (sessionStorage) afin de ne pas redevenir intrusif.
    try {
      const stored = window.sessionStorage.getItem("mapgeo:legend:userPref");
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      // sessionStorage indisponible : on continue avec la valeur par defaut
    }
    return true;
  });

  const persistShowLegend = useCallback((next) => {
    setShowLegend((current) => {
      const value = typeof next === "function" ? next(current) : next;
      try {
        window.sessionStorage.setItem("mapgeo:legend:userPref", value ? "1" : "0");
      } catch {
        // sessionStorage non critique : on ignore
      }
      return value;
    });
  }, []);

  const [viewMode, setViewMode] = useState(defaultViewMode);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState("reference");
  const [coordinateSystem] = useState("EPSG:32628");

  const [activeTab, setActiveTab] = useState("summary");
  const [showPrintDialog, setShowPrintDialog] = useState(false);

  const [viewportRequest, setViewportRequest] = useState({
    key: 0,
    reason: "initial",
  });

  const [identifyState, setIdentifyState] = useState(null);
  const [mapEditActive, setMapEditActive] = useState(false);
  const [createParcelPreviewGeometry, setCreateParcelPreviewGeometry] = useState(null);
  const [createParcelDrawingActive, setCreateParcelDrawingActive] = useState(false);

  const [parcelOverrides, setParcelOverrides] = useState({});
  const [deletedParcelIds, setDeletedParcelIds] = useState(() => new Set());

  const [viewportParcels, setViewportParcels] = useState([]);
  const [viewportLoading, setViewportLoading] = useState(false);
  const [viewportSummary, setViewportSummary] = useState({
    loaded: 0,
    total: 0,
    limit: 500,
    bbox: null,
    filters: {},
  });

  const [mapAccessBlocked, setMapAccessBlocked] = useState(false);
  const [mapAccessMessage, setMapAccessMessage] = useState("");

  const viewportFetchKeyRef = useRef("");
  const viewportFetchTimerRef = useRef(null);
  const viewportRequestSeqRef = useRef(0);
  const viewportAbortRef = useRef(null);

  const effectiveMapFilters = useMemo(() => {
    const nextFilters = { ...(mapFilters || {}) };

    if (clientCode && !nextFilters.owner_client_code) {
      nextFilters.owner_client_code = clientCode;
    }

    Object.keys(nextFilters).forEach((key) => {
      if (
        nextFilters[key] === undefined ||
        nextFilters[key] === null ||
        nextFilters[key] === ""
      ) {
        delete nextFilters[key];
      }
    });

    delete nextFilters.progress;

    return nextFilters;
  }, [clientCode, mapFilters]);

  const mapFilterKey = useMemo(
    () => JSON.stringify(effectiveMapFilters),
    [effectiveMapFilters],
  );

  const stopViewportLoading = useCallback(() => {
    if (viewportFetchTimerRef.current) {
      window.clearTimeout(viewportFetchTimerRef.current);
      viewportFetchTimerRef.current = null;
    }

    if (viewportAbortRef.current) {
      viewportAbortRef.current.abort();
      viewportAbortRef.current = null;
    }

    viewportRequestSeqRef.current += 1;
    setViewportLoading(false);
  }, []);

  const blockViewportRequests = useCallback(
    (error) => {
      stopViewportLoading();
      setMapAccessBlocked(true);
      setMapAccessMessage(getAccessErrorMessage(error));
    },
    [stopViewportLoading],
  );

  const retryViewportRequests = useCallback(() => {
    viewportFetchKeyRef.current = "";
    viewportRequestSeqRef.current += 1;
    setViewportLoading(false);
    setMapAccessBlocked(false);
    setMapAccessMessage("");
  }, []);

  const applyParcelOverride = useCallback(
    (parcel) => {
      if (!parcel?.id) return parcel;

      const override = parcelOverrides[String(parcel.id)];
      if (!override) return parcel;

      const hasGeometry = Object.prototype.hasOwnProperty.call(
        override,
        "geometry",
      );

      const hasCoordinatesText = Object.prototype.hasOwnProperty.call(
        override,
        "coordinates_text",
      );

      return {
        ...parcel,
        ...override,
        geometry: hasGeometry ? override.geometry : parcel.geometry,
        coordinates_text: hasCoordinatesText
          ? override.coordinates_text
          : parcel.coordinates_text,
        latitude: override.latitude ?? parcel.latitude,
        longitude: override.longitude ?? parcel.longitude,
        geometry_area_m2:
          override.geometry_area_m2 ?? parcel.geometry_area_m2,
      };
    },
    [parcelOverrides],
  );

  const effectiveParcels = useMemo(() => {
    const mergedById = new Map();

    [
      ...(Array.isArray(viewportParcels) ? viewportParcels : []),
      ...(Array.isArray(parcels) ? parcels : []),
    ].forEach((parcel) => {
      if (!parcel?.id || deletedParcelIds.has(String(parcel.id))) return;
      mergedById.set(String(parcel.id), applyParcelOverride(parcel));
    });

    return Array.from(mergedById.values());
  }, [parcels, viewportParcels, applyParcelOverride, deletedParcelIds]);

  const effectiveActiveParcel = useMemo(
    () => applyParcelOverride(activeParcel),
    [activeParcel, applyParcelOverride],
  );

  useEffect(() => {
    if (!map || mapAccessBlocked) return undefined;

    const loadVisibleParcels = () => {
      if (!map?.getBounds) return;

      const bounds = map.getBounds();
      const southWest = bounds.getSouthWest();
      const northEast = bounds.getNorthEast();

      const minProjected = lngLatToSenegalProjected(
        southWest.lng,
        southWest.lat,
      );

      const maxProjected = lngLatToSenegalProjected(
        northEast.lng,
        northEast.lat,
      );

      if (!minProjected || !maxProjected) return;

      const minX = Math.min(minProjected[0], maxProjected[0]);
      const minY = Math.min(minProjected[1], maxProjected[1]);
      const maxX = Math.max(minProjected[0], maxProjected[0]);
      const maxY = Math.max(minProjected[1], maxProjected[1]);

      const bbox = [minX, minY, maxX, maxY]
        .map((value) => roundBboxValue(value, 25).toFixed(0))
        .join(",");

      const zoom = typeof map.getZoom === "function" ? map.getZoom() : null;
      const simplifyTolerance = simplifyToleranceForZoom(zoom);

      const requestKey = `${bbox}|${mapFilterKey}|${simplifyTolerance}`;
      if (requestKey === viewportFetchKeyRef.current) return;

      viewportFetchKeyRef.current = requestKey;

      if (viewportFetchTimerRef.current) {
        window.clearTimeout(viewportFetchTimerRef.current);
      }

      viewportFetchTimerRef.current = window.setTimeout(async () => {
        viewportFetchTimerRef.current = null;

        const requestSeq = viewportRequestSeqRef.current + 1;
        viewportRequestSeqRef.current = requestSeq;

        if (viewportAbortRef.current) {
          viewportAbortRef.current.abort();
        }

        const abortController = new AbortController();
        viewportAbortRef.current = abortController;
        setViewportLoading(true);

        try {
          const payload = await parcelService.getParcelMap(
            {
              bbox,
              page_size: 500,
              simplify_tolerance: simplifyTolerance,
              ...effectiveMapFilters,
            },
            { signal: abortController.signal },
          );

          if (requestSeq !== viewportRequestSeqRef.current) return;

          const results = payload.results || [];
          const total = Number(payload.count ?? results.length);

          setViewportParcels(results);
          setViewportSummary({
            loaded: results.length,
            total,
            limit: 500,
            bbox,
            filters: effectiveMapFilters,
          });
        } catch (error) {
          if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED" || abortController.signal.aborted) return;
          if (requestSeq !== viewportRequestSeqRef.current) return;

          if (isAccessError(error)) {
            blockViewportRequests(error);
            return;
          }

          console.warn(
            "Impossible de charger les parcelles visibles sur la carte.",
            error,
          );
        } finally {
          if (viewportAbortRef.current === abortController) {
            viewportAbortRef.current = null;
          }

          if (requestSeq === viewportRequestSeqRef.current) {
            setViewportLoading(false);
          }
        }
      }, 350);
    };

    loadVisibleParcels();
    map.on("moveend zoomend", loadVisibleParcels);

    return () => {
      map.off("moveend zoomend", loadVisibleParcels);
      stopViewportLoading();
    };
  }, [
    map,
    mapFilterKey,
    effectiveMapFilters,
    mapAccessBlocked,
    blockViewportRequests,
    stopViewportLoading,
  ]);

  const portfolioIdentity = useMemo(() => {
    const firstParcel = effectiveParcels[0] || {};

    return {
      clientCode:
        clientCode ||
        effectiveActiveParcel?.owner_client_code ||
        firstParcel.owner_client_code ||
        "",
      ownerName:
        ownerName ||
        effectiveActiveParcel?.owner_name ||
        firstParcel.owner_name ||
        "",
    };
  }, [clientCode, ownerName, effectiveActiveParcel, effectiveParcels]);

  const layerState = useProfessionalLayers({
    sigLayers,
    userKey: `client:${portfolioIdentity.clientCode || "unknown"}|owner:${
      portfolioIdentity.ownerName || "unknown"
    }`,
    mapZoom,
  });

  const activeBaseLayer = useMemo(
    () =>
      layerState.baseLayers.find(
        (layer) => layer.id === layerState.activeBaseLayerId,
      ) || layerState.baseLayers[0],
    [layerState.baseLayers, layerState.activeBaseLayerId],
  );

  const parcelLayerVisible = layerState.isLayerEnabled("parcels-portfolio");
  const visibleExternalLayers = layerState.visibleOperationalLayers;

  useEffect(() => {
    setViewMode(defaultViewMode);
  }, [defaultViewMode, portfolioIdentity.clientCode]);

  const portfolio = usePortfolioFeatures({
    parcels: effectiveParcels,
    activeParcel: effectiveActiveParcel,
    searchTerm,
    searchMode,
    viewMode,
    mapZoom,
    showLabels,
    showMeasurements,
    activeLayerEnabled: parcelLayerVisible,
  });

  const requestViewportFocus = useCallback((reason) => {
    setViewportRequest((current) => ({
      key: current.key + 1,
      reason,
    }));
  }, []);

  const handleFocusSelection = useCallback(() => {
    setViewMode("selection");
    requestViewportFocus("manual_center");
  }, [requestViewportFocus]);

  const handleFeatureSelection = useCallback(
    (feature, options = {}) => {
      if (!feature) return;

      if (
        mapEditActive &&
        activeParcel?.id &&
        String(feature.id) !== String(activeParcel.id)
      ) {
        return;
      }

      // En mobile, on NE bascule PAS automatiquement vers l onglet "Fiche".
      // L utilisateur garde la carte visible et peut consulter la fiche
      // via la barre d onglets en bas s il le souhaite.
      onSelectParcel?.(feature.parcel);
      setIdentifyState({ feature, point: feature.center });
      setViewMode("selection");

      if (options.focus) {
        requestViewportFocus(options.reason || "explicit_focus");
      }
    },
    [activeParcel?.id, mapEditActive, onSelectParcel, requestViewportFocus],
  );

  const handleSidebarFeatureSelection = useCallback(
    (feature) => {
      handleFeatureSelection(feature, {
        focus: true,
        reason: "sidebar_selection",
      });
    },
    [handleFeatureSelection],
  );

  const handleSearchSubmit = useCallback(() => {
    const firstFeature = portfolio.filteredFeatures[0];

    if (firstFeature) {
      // On garde l utilisateur sur la carte. La parcelle est selectionnee
      // et le bandeau "Fiche" reste accessible via la barre d onglets.
      handleFeatureSelection(firstFeature, {
        focus: true,
        reason: "search",
      });
    }
  }, [portfolio.filteredFeatures, handleFeatureSelection]);

  const handleSaveParcelEdit = useCallback(
    async (parcelId, payload) => {
      try {
        const savedParcel = await parcelService.updateParcel(parcelId, payload);
        let authoritativeParcel = savedParcel || {};

        try {
          authoritativeParcel = await parcelService.getParcelById(
            savedParcel?.id || parcelId,
            { _refresh: Date.now() },
          );
        } catch (error) {
          if (isAccessError(error)) {
            blockViewportRequests(error);
            throw error;
          }

          console.warn(
            "La parcelle a été enregistrée, mais le rechargement détaillé a échoué.",
            error,
          );
        }

        const mergedParcel = {
          ...(payload || {}),
          ...(savedParcel || {}),
          ...(authoritativeParcel || {}),
          geometry:
            authoritativeParcel?.geometry ||
            savedParcel?.geometry ||
            payload?.geometry ||
            null,
          coordinates_text:
            authoritativeParcel?.coordinates_text ||
            savedParcel?.coordinates_text ||
            payload?.coordinates_text ||
            "",
          id: authoritativeParcel?.id || savedParcel?.id || parcelId,
          _local_geometry_revision: Date.now(),
        };

        setDeletedParcelIds((current) => {
          if (!current.has(String(mergedParcel.id))) return current;

          const next = new Set(current);
          next.delete(String(mergedParcel.id));
          return next;
        });

        setParcelOverrides((current) => ({
          ...current,
          [String(mergedParcel.id)]: mergedParcel,
        }));

        try {
          await onParcelUpdated?.(mergedParcel);
        } catch (error) {
          console.warn(
            "La parcelle a été enregistrée, mais le rafraîchissement parent a échoué.",
            error,
          );
        }

        return mergedParcel;
      } catch (error) {
        if (isAccessError(error)) {
          blockViewportRequests(error);
        }

        throw error;
      }
    },
    [blockViewportRequests, onParcelUpdated],
  );

  const handleDeleteParcel = useCallback(
    async (parcelId) => {
      if (!parcelId) return null;

      try {
        await parcelService.deleteParcel(parcelId);

        setDeletedParcelIds((current) => {
          const next = new Set(current);
          next.add(String(parcelId));
          return next;
        });

        setParcelOverrides((current) => {
          const next = { ...current };
          delete next[String(parcelId)];
          return next;
        });

        try {
          await onParcelDeleted?.(parcelId);
        } catch (error) {
          console.warn(
            "La parcelle a été archivée, mais le rafraîchissement parent a échoué.",
            error,
          );
        }

        return parcelId;
      } catch (error) {
        if (isAccessError(error)) {
          blockViewportRequests(error);
        }

        throw error;
      }
    },
    [blockViewportRequests, onParcelDeleted],
  );

  const handleCreateParcelRequest = useCallback(() => {
    setCreateParcelPreviewGeometry(null);
    setMobilePanel("inspector");
    onCreateParcel?.();
  }, [onCreateParcel]);

  const handleStartCreateGeometryDrawing = useCallback(() => {
    if (!canCreateParcel) return;

    setCreateParcelPreviewGeometry(null);
    setCreateParcelDrawingActive(true);
    setShowMeasurements(false);
    setShowVertices(false);
    setMobilePanel("map");
  }, [canCreateParcel]);

  const handleCreateGeometryDrawn = useCallback((geometry) => {
    setCreateParcelPreviewGeometry(geometry || null);
    setCreateParcelDrawingActive(false);
    setMobilePanel("inspector");
  }, []);

  const handleCancelCreateGeometryDrawing = useCallback(() => {
    setCreateParcelDrawingActive(false);
  }, []);

  return (
    <div
      className="mapgeo-portfolio-root flex h-full min-h-0 flex-col overflow-auto bg-[#07111b] px-3 pb-3 pt-2 text-mapgeo-primary md:px-4 md:pb-4 lg:overflow-hidden"
      data-mobile-panel={mobilePanel}
    >
      <div className="mapgeo-mobile-carto-tabs md:hidden" role="tablist" aria-label="Navigation cartographie mobile">
        <button type="button" aria-pressed={mobilePanel === "map"} onClick={() => setMobilePanel("map")} aria-label="Carte">
          <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21" /><line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" />
          </svg>
          <span>Carte</span>
        </button>
        <button type="button" aria-pressed={mobilePanel === "search"} onClick={() => setMobilePanel("search")} aria-label="Recherche parcelles">
          <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>Parcelles</span>
        </button>
        <button type="button" aria-pressed={mobilePanel === "inspector"} onClick={() => setMobilePanel("inspector")} aria-label="Fiche parcelle">
          <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" />
          </svg>
          <span>Fiche</span>
        </button>
      </div>
      <div className="mapgeo-portfolio-grid grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)] min-[1180px]:grid-cols-[300px_minmax(0,1fr)_340px] 2xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <PortfolioSidebar
          clientCode={portfolioIdentity.clientCode}
          ownerName={portfolioIdentity.ownerName}
          features={portfolio.features}
          communesCount={portfolio.communesCount}
          geometryCoverage={portfolio.geometryCoverage}
          portfolioDocuments={portfolio.portfolioDocuments}
          portfolioSpreadKm={portfolio.portfolioSpreadKm}
          searchTerm={searchTerm}
          searchMode={searchMode}
          onSearchTermChange={setSearchTerm}
          onSearchModeChange={setSearchMode}
          onSearchSubmit={handleSearchSubmit}
          filteredFeatures={portfolio.filteredFeatures}
          activeFeature={portfolio.activeFeature}
          onFeatureSelection={handleSidebarFeatureSelection}
          canCreateParcel={canManageParcels && canCreateParcel}
          onCreateParcel={canManageParcels ? handleCreateParcelRequest : undefined}
        />

        <PortfolioMapShell
          mapContainerRef={mapContainerRef}
          map={map}
          setMap={setMap}
          mapZoom={mapZoom}
          setMapZoom={setMapZoom}
          activeFeature={portfolio.activeFeature}
          viewportFeatures={portfolio.viewportFeatures}
          displayedFeatures={portfolio.displayedFeatures}
          filteredFeatures={portfolio.filteredFeatures}
          searchTerm={searchTerm}
          viewMode={viewMode}
          showLegend={showLegend}
          showVertices={showVertices}
          showMeasurements={showMeasurements}
          layerState={layerState}
          activeBaseLayer={activeBaseLayer}
          visibleExternalLayers={visibleExternalLayers}
          parcelLayerVisible={parcelLayerVisible}
          showLabels={showLabels}
          labelsAreVisible={portfolio.labelsAreVisible}
          setShowLabels={setShowLabels}
          legendFeatures={portfolio.legendFeatures}
          cursorPosition={cursorPosition}
          setCursorPosition={setCursorPosition}
          identifyState={identifyState}
          setIdentifyState={setIdentifyState}
          viewportRequest={viewportRequest}
          coordinateSystem={coordinateSystem}
          onFeatureSelection={handleFeatureSelection}
          onFocusSelection={handleFocusSelection}
          setShowLegend={persistShowLegend}
          setShowVertices={setShowVertices}
          setShowMeasurements={setShowMeasurements}
          setShowPrintDialog={setShowPrintDialog}
          onClearSearch={() => setSearchTerm("")}
          canManageParcels={canManageParcels}
          canArchiveParcels={canArchiveParcels}
          onSaveParcelEdit={canManageParcels ? handleSaveParcelEdit : undefined}
          onDeleteParcel={canArchiveParcels ? handleDeleteParcel : undefined}
          viewportSummary={viewportSummary}
          createParcelPreviewGeometry={createParcelPreviewGeometry}
          createParcelDrawingActive={createParcelDrawingActive}
          onCreateGeometryDrawn={handleCreateGeometryDrawn}
          onCancelCreateGeometryDrawing={handleCancelCreateGeometryDrawing}
          onInlineEditStateChange={setMapEditActive}
        />

        {viewportLoading && !mapAccessBlocked ? (
          <div className="pointer-events-none fixed bottom-5 right-5 z-[1100] rounded-full border border-white/10 bg-[#07111b]/82 px-3 py-1.5 text-xs font-bold text-white/70 shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur">
            Mise à jour des parcelles visibles…
          </div>
        ) : null}

        {mapAccessBlocked ? (
          <div className="fixed bottom-5 right-5 z-[1200] max-w-[360px] rounded-2xl border border-amber-300/30 bg-[#07111b]/94 p-3 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <p className="text-amber-100">
              {mapAccessMessage || "Session expirée ou accès refusé."}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={retryViewportRequests}
                className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white/80 transition hover:bg-white/10"
              >
                Réessayer
              </button>

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-mapgeo-primary px-3 py-1.5 text-xs font-bold text-white transition hover:bg-mapgeo-sand"
              >
                Recharger la page
              </button>
            </div>
          </div>
        ) : null}

        <div className="mapgeo-portfolio-inspector order-3 min-h-0 min-w-0 overflow-hidden lg:col-span-2 min-[1180px]:col-span-1 min-[1180px]:order-3"><PortfolioInspector
          activeFeature={portfolio.activeFeature}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          clientCode={portfolioIdentity.clientCode}
          ownerName={portfolioIdentity.ownerName}
          onFocusSelection={handleFocusSelection}
          onOpenPrintOptions={() => setShowPrintDialog(true)}
          canManageParcels={canManageParcels}
          onSaveParcelInfo={canManageParcels ? handleSaveParcelEdit : undefined}
          createParcelActive={canManageParcels && createParcelActive}
          createParcelOwners={canManageParcels ? createParcelOwners : []}
          createParcelDefaultOwnerId={
            canManageParcels ? createParcelDefaultOwnerId : null
          }
          onCancelCreateParcel={() => {
            setCreateParcelPreviewGeometry(null);
            setCreateParcelDrawingActive(false);
            onCancelCreateParcel?.();
          }}
          onCreateGeometryPreview={setCreateParcelPreviewGeometry}
          onStartCreateGeometryDrawing={handleStartCreateGeometryDrawing}
          createGeometryPreviewValue={createParcelPreviewGeometry}
          onParcelCreated={async (newParcel) => {
            setCreateParcelPreviewGeometry(null);
            setCreateParcelDrawingActive(false);
            // Ajoute immédiatement la nouvelle parcelle aux overrides pour l'afficher sur la carte
            // avant que le viewport ne se rafraîchisse
            if (newParcel?.id) {
              setParcelOverrides((current) => ({
                ...current,
                [String(newParcel.id)]: newParcel,
              }));
              // Invalide le cache viewport pour forcer un refresh au prochain déplacement
              viewportFetchKeyRef.current = "";
            }
            await onParcelCreated?.(newParcel);
          }}
        />
        </div>
      </div>

      <PrintMapDialog
        open={showPrintDialog}
        onClose={() => setShowPrintDialog(false)}
        mapContainerRef={mapContainerRef}
        activeFeature={portfolio.activeFeature}
        activeLayers={visibleExternalLayers}
        author={portfolioIdentity.ownerName || portfolioIdentity.clientCode || ""}
      />
    </div>
  );
}
