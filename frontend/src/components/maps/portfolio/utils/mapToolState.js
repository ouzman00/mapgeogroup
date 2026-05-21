export const MAP_ACTIVE_MODES = Object.freeze({
  IDLE: "idle",
  MEASURE: "measure",
  EDIT_GEOMETRY: "editGeometry",
  CREATE_PARCEL: "createParcel",
  DELETE_VERTEX: "deleteVertex",
  EXPORT: "export",
});

export function getActiveMapMode({
  showMeasurements = false,
  inlineEditOpen = false,
  createParcelDrawingActive = false,
  deleteVertexMode = false,
  activeCommand = null,
} = {}) {
  if (createParcelDrawingActive) return MAP_ACTIVE_MODES.CREATE_PARCEL;
  if (showMeasurements) return MAP_ACTIVE_MODES.MEASURE;
  if (inlineEditOpen && deleteVertexMode) return MAP_ACTIVE_MODES.DELETE_VERTEX;
  if (inlineEditOpen) return MAP_ACTIVE_MODES.EDIT_GEOMETRY;
  if (activeCommand === "export") return MAP_ACTIVE_MODES.EXPORT;
  return MAP_ACTIVE_MODES.IDLE;
}

export function isExclusiveMapMode(mode) {
  return [
    MAP_ACTIVE_MODES.MEASURE,
    MAP_ACTIVE_MODES.EDIT_GEOMETRY,
    MAP_ACTIVE_MODES.CREATE_PARCEL,
    MAP_ACTIVE_MODES.DELETE_VERTEX,
    MAP_ACTIVE_MODES.EXPORT,
  ].includes(mode);
}

export function canUsePassiveOverlay(activeMode, overlayName) {
  if (!activeMode || activeMode === MAP_ACTIVE_MODES.IDLE) return true;

  if (overlayName === "legend" || overlayName === "labels") {
    return true;
  }

  if (overlayName === "vertices" || overlayName === "dimensions") {
    return activeMode !== MAP_ACTIVE_MODES.EXPORT;
  }

  return true;
}
