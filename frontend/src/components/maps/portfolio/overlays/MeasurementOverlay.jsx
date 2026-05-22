import { memo } from "react";
import { CircleMarker, Polygon, Polyline, Tooltip } from "react-leaflet";
import { getMeasurementPreviewPoints, stripDimensionClosingPoint } from "../utils/dimensionOverlays";

const MAP_PANES = {
  measure: "mapgeo-measure-pane",
};

const MEASURE_STYLE = {
  line: "#38bdf8",
  fill: "#0ea5e9",
  vertex: "#fbbf24",
  snap: "#34d399",
};

function pointsAreSame(a, b, tolerance = 1e-9) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return (
    Math.abs(Number(a[0]) - Number(b[0])) <= tolerance &&
    Math.abs(Number(a[1]) - Number(b[1])) <= tolerance
  );
}

function isMobileCartographyViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(max-width: 767px)")?.matches || window.innerWidth < 768;
}

function getSnapKindLabel(kind) {
  if (kind === "measurement") return "point de mesure";
  if (kind === "vertex") return "sommet";
  if (kind === "segment") return "segment";
  return "auto";
}

function MeasurementOverlay({ draft }) {
  const points = draft?.points || [];
  const previewPoints = getMeasurementPreviewPoints(draft);

  if (!previewPoints.length) return null;

  const isMobileMeasureOverlay = isMobileCartographyViewport();
  const isSurface = draft.mode === "surface";
  const polygonPoints = isSurface
    ? stripDimensionClosingPoint(previewPoints)
    : previewPoints;

  const lastFixedPoint = points[points.length - 1];

  const hasCursorPreview = Boolean(
    draft?.cursorPoint &&
      !draft?.finished &&
      (!lastFixedPoint || !pointsAreSame(lastFixedPoint, draft.cursorPoint)),
  );

  const cursorTooltip = points.length ? "Point suivant" : "Premier point";

  return (
    <>
      {isSurface && polygonPoints.length >= 3 ? (
        <Polygon
          positions={polygonPoints}
          pane={MAP_PANES.measure}
          pathOptions={{
            color: MEASURE_STYLE.line,
            fillColor: MEASURE_STYLE.fill,
            fillOpacity: 0.12,
            opacity: 1,
            weight: 3.2,
            dashArray: "7 6",
            lineJoin: "round",
          }}
          interactive={false}
        />
      ) : null}

      {previewPoints.length >= 2 ? (
        <Polyline
          positions={previewPoints}
          pane={MAP_PANES.measure}
          pathOptions={{
            color: MEASURE_STYLE.line,
            opacity: 1,
            weight: 3.6,
            dashArray: "8 6",
            lineJoin: "round",
          }}
          interactive={false}
        />
      ) : null}

      {points.map((point, index) => (
        <CircleMarker
          key={`measure-point-${index}`}
          center={point}
          pane={MAP_PANES.measure}
          radius={6}
          pathOptions={{
            color: MEASURE_STYLE.pointBorder,
            fillColor: MEASURE_STYLE.pointFill,
            fillOpacity: 0.96,
            opacity: 1,
            weight: 2.5,
          }}
          interactive={false}
        />
      ))}

      {hasCursorPreview ? (
        <CircleMarker
          center={draft.cursorPoint}
          pane={MAP_PANES.measure}
          radius={7}
          pathOptions={{
            color: MEASURE_STYLE.cursorBorder,
            fillColor: MEASURE_STYLE.cursorFill,
            fillOpacity: 0.78,
            opacity: 1,
            weight: 2.4,
          }}
          interactive={false}
        >
          <Tooltip direction="top" permanent>
            {cursorTooltip}
          </Tooltip>
        </CircleMarker>
      ) : null}

      {draft?.snapPoint && !draft?.finished && !isMobileMeasureOverlay ? (
        <CircleMarker
          center={draft.snapPoint}
          pane={MAP_PANES.measure}
          radius={10}
          pathOptions={{
            color: MEASURE_STYLE.snapBorder,
            fillColor: MEASURE_STYLE.snapFill,
            fillOpacity: 0.22,
            opacity: 1,
            weight: 2.8,
            dashArray: "3 3",
          }}
          interactive={false}
        >
          <Tooltip direction="top" permanent>
            Accrochage {getSnapKindLabel(draft.snapKind)}
          </Tooltip>
        </CircleMarker>
      ) : null}
    </>
  );
}

export default memo(MeasurementOverlay);
