import { normalizeToMultiPolygon } from "./geometryIo.js";
const DEFAULT_MIN_AREA_M2 = 1;
const WARNING_AREA_M2 = 10;

function issue(level, code, message, details = "") {
  return { level, code, message, details };
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return ring || [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, first];
  return ring;
}

function ringWithoutClosingPoint(ring) {
  if (!Array.isArray(ring)) return [];
  if (ring.length <= 1) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) return ring.slice(0, -1);
  return ring;
}

function projectPoint([x, y]) {
  return [Number(x) || 0, Number(y) || 0];
}

function signedRingAreaM2(ring) {
  const closed = closeRing(ring);
  if (closed.length < 4) return 0;
  const projected = closed.map((point) => projectPoint(point));
  let area = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const [x1, y1] = projected[index];
    const [x2, y2] = projected[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

export function polygonAreaM2(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return 0;
  const outerArea = Math.abs(signedRingAreaM2(polygon[0]));
  const holesArea = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(signedRingAreaM2(ring)), 0);
  return Math.max(0, outerArea - holesArea);
}

export function multiPolygonAreaM2(geometry) {
  const normalized = normalizeToMultiPolygon(geometry);
  if (!normalized) return 0;
  return normalized.coordinates.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    Math.min(a[0], c[0]) - 1e-12 <= b[0] && b[0] <= Math.max(a[0], c[0]) + 1e-12 &&
    Math.min(a[1], c[1]) - 1e-12 <= b[1] && b[1] <= Math.max(a[1], c[1]) + 1e-12
  );
}

function pointsEqual(a, b) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function ringSegments(ring) {
  const closed = closeRing(ring);
  return closed.slice(0, -1).map((point, index) => [point, closed[index + 1], index]);
}

function isAdjacentSegment(indexA, indexB, segmentCount) {
  if (indexA === indexB) return true;
  if (Math.abs(indexA - indexB) === 1) return true;
  return (indexA === 0 && indexB === segmentCount - 1) || (indexB === 0 && indexA === segmentCount - 1);
}

function ringHasSelfIntersection(ring) {
  const segments = ringSegments(ring);
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const [a, b, indexA] = segments[i];
      const [c, d, indexB] = segments[j];
      if (isAdjacentSegment(indexA, indexB, segments.length)) continue;
      if (pointsEqual(a, c) || pointsEqual(a, d) || pointsEqual(b, c) || pointsEqual(b, d)) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  const closed = closeRing(ring);
  let inside = false;

  for (let i = 0, j = closed.length - 1; i < closed.length; j = i, i += 1) {
    const [xi, yi] = closed[i];
    const [xj, yj] = closed[j];

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function ringsIntersect(ringA, ringB) {
  const segmentsA = ringSegments(ringA);
  const segmentsB = ringSegments(ringB);

  for (const [a, b] of segmentsA) {
    for (const [c, d] of segmentsB) {
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }

  return false;
}

function bboxOfRing(ring) {
  const points = ringWithoutClosingPoint(ring);
  return points.reduce(
    (bbox, [lng, lat]) => ({
      minX: Math.min(bbox.minX, lng),
      minY: Math.min(bbox.minY, lat),
      maxX: Math.max(bbox.maxX, lng),
      maxY: Math.max(bbox.maxY, lat),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function bboxIntersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function polygonsOverlap(polygonA, polygonB) {
  if (!Array.isArray(polygonA?.[0]) || !Array.isArray(polygonB?.[0])) return false;
  const bboxA = bboxOfRing(polygonA[0]);
  const bboxB = bboxOfRing(polygonB[0]);
  if (!bboxIntersects(bboxA, bboxB)) return false;
  if (ringsIntersect(polygonA[0], polygonB[0])) return true;

  const pointA = ringWithoutClosingPoint(polygonA[0])[0];
  const pointB = ringWithoutClosingPoint(polygonB[0])[0];
  if (pointA && pointInRing(pointA, polygonB[0])) return true;
  if (pointB && pointInRing(pointB, polygonA[0])) return true;
  return false;
}

function normalizeProjectedBounds(value) {
  if (!value) return null;

  const minX = Number(value.minX);
  const minY = Number(value.minY);
  const maxX = Number(value.maxX);
  const maxY = Number(value.maxY);

  if ([minX, minY, maxX, maxY].every(Number.isFinite) && minX < maxX && minY < maxY) {
    return { minX, minY, maxX, maxY };
  }

  return null;
}

function getExpectedBounds(parcel) {
  const parcelBounds = normalizeProjectedBounds(parcel?.expected_bounds);
  if (parcelBounds) return parcelBounds;

  const rawBounds = import.meta.env?.VITE_GEOMETRY_EXPECTED_BOUNDS;
  if (!rawBounds) return null;

  try {
    const parsed = JSON.parse(rawBounds);

    if (Array.isArray(parsed) && parsed.length === 4) {
      const [minX, minY, maxX, maxY] = parsed.map(Number);
      return normalizeProjectedBounds({ minX, minY, maxX, maxY });
    }

    return normalizeProjectedBounds(parsed);
  } catch {
    return null;
  }
}


function pointOutsideBounds([x, y], bounds) {
  if (!bounds) return false;
  return x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
}

function collectReferenceGeometries(parcel) {
  const candidates = [
    parcel?.neighbor_geometries,
    parcel?.adjacent_geometries,
    parcel?.overlap_check_geometries,
    parcel?.nearby_parcel_geometries,
    parcel?.cadastre_geometries,
  ];

  return candidates
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .map((entry) => normalizeToMultiPolygon(entry?.geometry || entry))
    .filter(Boolean);
}

export function validateParcelGeometry(geometry, parcel = {}, options = {}) {
  const issues = [];
  const normalized = normalizeToMultiPolygon(geometry);
  const minAreaM2 = Number(options.minAreaM2 || parcel?.min_area_m2 || import.meta.env?.VITE_GEOMETRY_MIN_AREA_M2 || DEFAULT_MIN_AREA_M2);
  const expectedBounds = options.expectedBounds || getExpectedBounds(parcel);

  if (!normalized) {
    return {
      status: "blocking",
      areaM2: 0,
      issues: [issue("blocking", "missing_geometry", "Aucune géométrie Polygon/MultiPolygon valide n'est disponible.")],
    };
  }

  if (normalized.type !== "MultiPolygon") {
    issues.push(issue("blocking", "not_multipolygon", "La géométrie sauvegardée doit être normalisée en MultiPolygon."));
  }

  normalized.coordinates.forEach((polygon, polygonIndex) => {
    if (!polygon.length) {
      issues.push(issue("blocking", "empty_polygon", `Le polygone ${polygonIndex + 1} est vide.`));
      return;
    }

    polygon.forEach((ring, ringIndex) => {
      const uniquePoints = ringWithoutClosingPoint(ring);
      if (uniquePoints.length < 3) {
        issues.push(issue("blocking", "ring_too_short", `L'anneau ${polygonIndex + 1}.${ringIndex + 1} contient moins de 3 sommets.`));
      }

      const invalidPointIndex = uniquePoints.findIndex(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat));
      if (invalidPointIndex >= 0) {
        issues.push(issue("blocking", "invalid_coordinate", `Coordonnée invalide dans l'anneau ${polygonIndex + 1}.${ringIndex + 1}.`));
      }

      const outsidePointIndex = expectedBounds
        ? uniquePoints.findIndex((point) => pointOutsideBounds(point, expectedBounds))
        : -1;
      if (outsidePointIndex >= 0) {
        const [lng, lat] = uniquePoints[outsidePointIndex];
        issues.push(issue(
          "blocking",
          "coordinate_outside_expected_bounds",
          `Un sommet sort de la zone attendue dans l'anneau ${polygonIndex + 1}.${ringIndex + 1}.`,
          `Sommet ${outsidePointIndex + 1} : X=${lng.toFixed(3)} m, Y=${lat.toFixed(3)} m`,
        ));
      }

      if (ringHasSelfIntersection(ring)) {
        issues.push(issue("blocking", "self_intersection", `Auto-intersection détectée dans l'anneau ${polygonIndex + 1}.${ringIndex + 1}.`));
      }
    });

    const outer = polygon[0];
    polygon.slice(1).forEach((hole, holeIndex) => {
      const testPoint = ringWithoutClosingPoint(hole)[0];
      if (!testPoint || !pointInRing(testPoint, outer)) {
        issues.push(issue("blocking", "hole_outside_polygon", `Le trou ${polygonIndex + 1}.${holeIndex + 1} n'est pas entièrement dans le polygone principal.`));
      }
      if (ringsIntersect(hole, outer)) {
        issues.push(issue("blocking", "hole_intersects_outer", `Le trou ${polygonIndex + 1}.${holeIndex + 1} coupe la limite extérieure.`));
      }
    });

    for (let i = 1; i < polygon.length; i += 1) {
      for (let j = i + 1; j < polygon.length; j += 1) {
        if (polygonsOverlap([polygon[i]], [polygon[j]]) || ringsIntersect(polygon[i], polygon[j])) {
          issues.push(issue("blocking", "holes_overlap", `Les trous ${polygonIndex + 1}.${i} et ${polygonIndex + 1}.${j} se chevauchent.`));
        }
      }
    }
  });

  for (let i = 0; i < normalized.coordinates.length; i += 1) {
    for (let j = i + 1; j < normalized.coordinates.length; j += 1) {
      if (polygonsOverlap(normalized.coordinates[i], normalized.coordinates[j])) {
        issues.push(issue("blocking", "internal_polygon_overlap", `Les polygones ${i + 1} et ${j + 1} du MultiPolygon se chevauchent.`));
      }
    }
  }

  const referenceGeometries = collectReferenceGeometries(parcel);
  referenceGeometries.forEach((referenceGeometry, referenceIndex) => {
    normalized.coordinates.forEach((polygon, polygonIndex) => {
      const overlaps = referenceGeometry.coordinates.some((referencePolygon) => polygonsOverlap(polygon, referencePolygon));
      if (overlaps) {
        issues.push(issue(
          "blocking",
          "external_parcel_overlap",
          `Chevauchement détecté avec une autre parcelle ou une limite cadastrale de référence.`,
          `Parcelle ${polygonIndex + 1}, référence ${referenceIndex + 1}`,
        ));
      }
    });
  });

  const areaM2 = multiPolygonAreaM2(normalized);
  if (areaM2 < minAreaM2) {
    issues.push(issue("blocking", "area_too_small", `Surface inférieure au minimum autorisé (${minAreaM2.toLocaleString("fr-FR")} m²).`));
  } else if (areaM2 < Math.max(minAreaM2, WARNING_AREA_M2)) {
    issues.push(issue("warning", "area_small", "Surface très faible : vérifier que la saisie n'est pas accidentelle."));
  }

  const holeCount = normalized.coordinates.reduce((sum, polygon) => sum + Math.max(0, polygon.length - 1), 0);
  if (holeCount > 0) {
    issues.push(issue("warning", "holes_present", `${holeCount} trou${holeCount > 1 ? "s" : ""} détecté${holeCount > 1 ? "s" : ""} : vérifier les enclaves et servitudes.`));
  }

  if (!issues.length) {
    issues.push(issue("valid", "geometry_valid", "Géométrie valide : aucun blocage topologique détecté."));
  }

  const hasBlocking = issues.some((entry) => entry.level === "blocking");
  const hasWarning = issues.some((entry) => entry.level === "warning");

  return {
    status: hasBlocking ? "blocking" : hasWarning ? "warning" : "valid",
    areaM2,
    issues,
    normalizedGeometry: normalized,
  };
}
