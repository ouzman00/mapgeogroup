import {
  SENEGAL_PROJECTED_CRS,
  lngLatToSenegalProjected,
  senegalProjectedToLngLat,
} from "./parcelGeometry";

export const WGS84_GEOGRAPHIC_CRS = "EPSG:4326";

export const GEOMETRY_IMPORT_CRS_OPTIONS = [
  {
    value: SENEGAL_PROJECTED_CRS,
    label: "X/Y EPSG:32628 (mètres)",
  },
  {
    value: WGS84_GEOGRAPHIC_CRS,
    label: "Lon/Lat EPSG:4326",
  },
];

export function getDefaultSourceCrsForFormat(format) {
  // Le projet travaille en coordonnées métriques. CSV/WKT/GeoJSON saisis à la main
  // sont donc interprétés en EPSG:32628 par défaut.
  const normalized = String(format || "").toLowerCase();
  if (normalized === "kml") return WGS84_GEOGRAPHIC_CRS;
  return SENEGAL_PROJECTED_CRS;
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return ring || [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first];
  }
  return ring;
}

function normalizeSourceCrs(sourceCrs) {
  return String(sourceCrs || SENEGAL_PROJECTED_CRS).trim().toUpperCase();
}

function sanitizeJsonText(text) {
  return String(text || "")
    .trim()
    .replace(/^\ufeff/, "")
    // Supprime les espaces de groupement copiés depuis l'UI : 287 802 -> 287802.
    .replace(/(?<=\d)[\u00a0\u202f\s](?=\d{3}(?:\D|$))/g, "");
}

function inferGeometryFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return null;

  const isPair = (value) =>
    Array.isArray(value) &&
    value.length >= 2 &&
    !Array.isArray(value[0]) &&
    !Array.isArray(value[1]);

  const isRing = (value) => Array.isArray(value) && value.length >= 3 && value.every(isPair);
  const isPolygon = (value) => Array.isArray(value) && value.length >= 1 && value.every(isRing);
  const isMultiPolygon = (value) => Array.isArray(value) && value.length >= 1 && value.every(isPolygon);

  if (isRing(coordinates)) {
    return { type: "Polygon", coordinates: [coordinates] };
  }

  if (isPolygon(coordinates)) {
    return { type: "Polygon", coordinates };
  }

  if (isMultiPolygon(coordinates)) {
    return { type: "MultiPolygon", coordinates };
  }

  return null;
}

function coerceGeoJsonCandidate(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    return inferGeometryFromCoordinates(value);
  }

  if (typeof value !== "object") return null;

  if (value.type === "Feature" && value.geometry) {
    return { ...value, geometry: coerceGeoJsonCandidate(value.geometry) || value.geometry };
  }

  if (value.type === "FeatureCollection") {
    return value;
  }

  if (["Polygon", "MultiPolygon"].includes(value.type) && value.coordinates) {
    return value;
  }

  // Tolérance UX : certains collages donnent { geometry: { ... } } sans type Feature explicite.
  if (value.geometry) {
    return coerceGeoJsonCandidate(value.geometry);
  }

  // Tolérance UX : accepte { coordinates: [...] } ou un Feature mal formé avec
  // coordinates au mauvais niveau, puis infère Polygon/MultiPolygon.
  if (value.coordinates) {
    return inferGeometryFromCoordinates(value.coordinates);
  }

  return null;
}

function convertPairToProjected(x, y, options = {}) {
  const first = Number(x);
  const second = Number(y);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const sourceCrs = normalizeSourceCrs(options.sourceCrs);
  if (sourceCrs === WGS84_GEOGRAPHIC_CRS) {
    return lngLatToSenegalProjected(first, second);
  }

  return [first, second];
}

function convertProjectedPairToLngLat(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  return senegalProjectedToLngLat(pair[0], pair[1]);
}

function mapCoordinatesDeep(value, converter) {
  if (!Array.isArray(value)) return value;
  if (
    value.length >= 2 &&
    !Array.isArray(value[0]) &&
    !Array.isArray(value[1])
  ) {
    return converter(value);
  }
  return value.map((item) => mapCoordinatesDeep(item, converter));
}

export function projectedGeometryToWgs84(geometry) {
  if (!geometry || typeof geometry !== "object") return geometry;
  if (geometry.type === "Feature") {
    return { ...geometry, geometry: projectedGeometryToWgs84(geometry.geometry) };
  }
  if (geometry.type === "FeatureCollection") {
    return { ...geometry, features: (geometry.features || []).map(projectedGeometryToWgs84) };
  }
  if (geometry.type === "GeometryCollection") {
    return { ...geometry, geometries: (geometry.geometries || []).map(projectedGeometryToWgs84) };
  }
  if (!geometry.coordinates) return geometry;
  return {
    ...geometry,
    coordinates: mapCoordinatesDeep(geometry.coordinates, (pair) => convertProjectedPairToLngLat(pair) || pair),
  };
}

export function wgs84GeometryToProjected(geometry) {
  return normalizeGeometryCrs(geometry, { sourceCrs: WGS84_GEOGRAPHIC_CRS });
}

export function normalizeGeometryCrs(geometry, options = {}) {
  if (!geometry || typeof geometry !== "object") return geometry;
  if (geometry.type === "Feature") {
    return { ...geometry, geometry: normalizeGeometryCrs(geometry.geometry, options) };
  }
  if (geometry.type === "FeatureCollection") {
    return { ...geometry, features: (geometry.features || []).map((feature) => normalizeGeometryCrs(feature, options)) };
  }
  if (geometry.type === "GeometryCollection") {
    return { ...geometry, geometries: (geometry.geometries || []).map((item) => normalizeGeometryCrs(item, options)) };
  }
  if (!geometry.coordinates) return geometry;
  return {
    ...geometry,
    coordinates: mapCoordinatesDeep(geometry.coordinates, (pair) => convertPairToProjected(pair[0], pair[1], options) || pair),
  };
}

function toNumberPair(pair, options = {}) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  return convertPairToProjected(pair[0], pair[1], options);
}

function normalizeRing(ring, options = {}) {
  const points = (Array.isArray(ring) ? ring : []).map((pair) => toNumberPair(pair, options)).filter(Boolean);
  return points.length >= 3 ? closeRing(points) : [];
}

function normalizePolygon(polygon, options = {}) {
  return (Array.isArray(polygon) ? polygon : [])
    .map((ring) => normalizeRing(ring, options))
    .filter((ring) => ring.length >= 4);
}

export function normalizeToMultiPolygon(geometry, options = {}) {
  if (!geometry?.type) return null;

  if (geometry.type === "Feature") {
    return normalizeToMultiPolygon(geometry.geometry, options);
  }

  if (geometry.type === "FeatureCollection") {
    const polygons = [];
    for (const feature of geometry.features || []) {
      const normalized = normalizeToMultiPolygon(feature.geometry, options);
      if (normalized?.coordinates?.length) polygons.push(...normalized.coordinates);
    }
    return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
  }

  if (!geometry.coordinates) return null;

  if (geometry.type === "Polygon") {
    const polygon = normalizePolygon(geometry.coordinates, options);
    return polygon.length ? { type: "MultiPolygon", coordinates: [polygon] } : null;
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates.map((polygon) => normalizePolygon(polygon, options)).filter((polygon) => polygon.length);
    return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
  }

  return null;
}

export function parseGeoJsonGeometry(text, options = {}) {
  let parsed;

  try {
    parsed = JSON.parse(sanitizeJsonText(text));
  } catch {
    throw new Error(
      "JSON invalide. Astuce : pour saisir une géométrie simplement, passe en mode CSV et entre tes coordonnées au format x,y;x,y;x,y (une paire par sommet, séparées par des points-virgules).",
    );
  }

  const candidate = coerceGeoJsonCandidate(parsed);
  const normalized = normalizeToMultiPolygon(candidate, options);

  if (!normalized) {
    throw new Error(
      "Le GeoJSON ne contient pas de Polygon ou MultiPolygon exploitable. Formats acceptés : { type: 'Polygon', coordinates: [...] }, Feature GeoJSON, ou tableau de coordonnées. Pour saisir manuellement, utilise le mode CSV avec x,y;x,y;x,y.",
    );
  }

  return normalized;
}

function parseCoordinateList(value, options = {}) {
  return value
    .replace(/^\(+|\)+$/g, "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [x, y] = token.split(/\s+/).map(Number);
      const pair = convertPairToProjected(x, y, options);
      if (!pair) {
        throw new Error(`Coordonnée WKT invalide : ${token}`);
      }
      return pair;
    });
}

function splitTopLevelGroups(value) {
  const groups = [];
  let depth = 0;
  let start = -1;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      if (depth === 0) start = index + 1;
      depth += 1;
    }
    if (character === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        groups.push(value.slice(start, index));
        start = -1;
      }
    }
  }

  return groups;
}

function stripOuterParentheses(value) {
  const text = value.trim();
  if (!text.startsWith("(") || !text.endsWith(")")) return text;

  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < text.length - 1) return text;
  }

  return text.slice(1, -1).trim();
}

export function parseWktGeometry(rawText, options = {}) {
  const text = rawText.trim();
  const type = text.slice(0, text.indexOf("(")).trim().toUpperCase();
  const body = text.slice(text.indexOf("("));

  if (type === "POLYGON") {
    const rings = splitTopLevelGroups(stripOuterParentheses(body)).map((ringText) => parseCoordinateList(ringText, options)).map(closeRing);
    const normalized = normalizeToMultiPolygon({ type: "Polygon", coordinates: rings });
    if (!normalized) throw new Error("WKT Polygon invalide.");
    return normalized;
  }

  if (type === "MULTIPOLYGON") {
    const polygons = splitTopLevelGroups(stripOuterParentheses(body)).map((polygonText) =>
      splitTopLevelGroups(polygonText).map((ringText) => parseCoordinateList(ringText, options)).map(closeRing),
    );
    const normalized = normalizeToMultiPolygon({ type: "MultiPolygon", coordinates: polygons });
    if (!normalized) throw new Error("WKT MultiPolygon invalide.");
    return normalized;
  }

  throw new Error("Seuls les WKT POLYGON et MULTIPOLYGON sont supportés dans cet éditeur cadastral.");
}

export function parseKmlGeometry(text) {
  const parser = new DOMParser();
  const documentXml = parser.parseFromString(text, "application/xml");
  const parseError = documentXml.querySelector("parsererror");
  if (parseError) throw new Error("KML invalide ou mal formé.");

  const polygons = Array.from(documentXml.querySelectorAll("Polygon")).map((polygonNode) => {
    const outerCoordinates = polygonNode.querySelector("outerBoundaryIs coordinates")?.textContent ||
      polygonNode.querySelector("outerBoundaryIs LinearRing coordinates")?.textContent;

    if (!outerCoordinates) return null;

    const outerRing = outerCoordinates
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const [lng, lat] = token.split(",").map(Number);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return lngLatToSenegalProjected(lng, lat);
      })
      .filter(Boolean);

    const holes = Array.from(polygonNode.querySelectorAll("innerBoundaryIs coordinates, innerBoundaryIs LinearRing coordinates"))
      .map((node) =>
        node.textContent
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((token) => {
            const [lng, lat] = token.split(",").map(Number);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
            return lngLatToSenegalProjected(lng, lat);
          })
          .filter(Boolean),
      )
      .filter((ring) => ring.length >= 3);

    return [closeRing(outerRing), ...holes.map(closeRing)];
  }).filter(Boolean);

  const normalized = normalizeToMultiPolygon({ type: "MultiPolygon", coordinates: polygons });
  if (!normalized) throw new Error("Aucun Polygon KML exploitable n'a été trouvé.");
  return normalized;
}

function countDelimiterOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && character === delimiter) {
      count += 1;
    }
  }

  return count;
}

function guessCsvDelimiter(lines) {
  const sample = lines.find((line) => line.trim()) || "";
  const candidates = [";", ",", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiterOutsideQuotes(sample, delimiter) }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ",";
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeaderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\ufeff/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseCsvNumber(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^\ufeff/, "")
    .replace(/\s|\u00a0/g, "")
    .replace(/,/g, ".");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function isNumericCell(value) {
  return parseCsvNumber(value) !== null;
}

/**
 * Tente de parser un texte comme une séquence de coordonnées X,Y séparées
 * par des points-virgules, sauts de ligne ou tabulations.
 *
 * Formats acceptés :
 *   - "x1;y1;x2;y2;x3;y3"        (plat, alternance)
 *   - "x1,y1;x2,y2;x3,y3"        (paires virgule)
 *   - "x1,y1\nx2,y2\nx3,y3"      (paires newline)
 *   - "x1 y1\nx2 y2\nx3 y3"      (paires espace)
 *
 * Retourne un GeoJSON MultiPolygon ou null si non reconnu.
 */
function parseFlatCoordinateSequenceGeometry(value) {
  const text = String(value || "").trim();
  if (!text || /[{}\[\]]/.test(text)) return null;
  // Reject clearly JSON/GeoJSON/KML/WKT content
  if (text.startsWith("{") || text.startsWith("[") || text.toLowerCase().startsWith("polygon")
    || text.toLowerCase().startsWith("multipolygon") || text.toLowerCase().startsWith("<")) return null;

  // Format "x,y;x,y;x,y" — paires séparées par ";"
  if (/[;\n\r\t]/.test(text)) {
    // Chaque token peut être "x,y" ou un nombre seul
    const tokens = text
      .split(/[;\n\r\t]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    // Cas: tokens sont des paires "x,y"
    const pairPattern = tokens.every((t) => /^-?[\d.,]+,-?[\d.,]+$/.test(t));
    if (pairPattern && tokens.length >= 3) {
      const ring = tokens.map((t) => {
        const parts = t.split(",");
        const x = parseCsvNumber(parts[0]);
        const y = parseCsvNumber(parts[1]);
        return x !== null && y !== null ? [x, y] : null;
      }).filter(Boolean);
      if (ring.length >= 3) return { type: "MultiPolygon", coordinates: [[ring]] };
    }

    // Cas: tokens sont des nombres plats alternés x;y;x;y
    if (tokens.length >= 6 && tokens.length % 2 === 0 && tokens.every((t) => isNumericCell(t))) {
      const ring = [];
      for (let i = 0; i < tokens.length; i += 2) {
        const x = parseCsvNumber(tokens[i]);
        const y = parseCsvNumber(tokens[i + 1]);
        if (x === null || y === null) return null;
        ring.push([x, y]);
      }
      if (ring.length >= 3) return { type: "MultiPolygon", coordinates: [[ring]] };
    }
  }

  // Format "x y\nx y\nx y" — paires espace sur lignes
  if (/\n/.test(text)) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const spacePairs = lines.every((l) => /^-?[\d.]+\s+-?[\d.]+$/.test(l));
    if (spacePairs && lines.length >= 3) {
      const ring = lines.map((l) => {
        const parts = l.split(/\s+/);
        const x = parseCsvNumber(parts[0]);
        const y = parseCsvNumber(parts[1]);
        return x !== null && y !== null ? [x, y] : null;
      }).filter(Boolean);
      if (ring.length >= 3) return { type: "MultiPolygon", coordinates: [[ring]] };
    }
  }

  // Format "x y x y x y" — liste plate espace sur une seule ligne
  // (minimum 6 tokens = 3 paires)
  const singleLineTokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (
    singleLineTokens.length >= 6 &&
    singleLineTokens.length % 2 === 0 &&
    singleLineTokens.every((t) => isNumericCell(t))
  ) {
    const ring = [];
    for (let i = 0; i < singleLineTokens.length; i += 2) {
      const x = parseCsvNumber(singleLineTokens[i]);
      const y = parseCsvNumber(singleLineTokens[i + 1]);
      if (x === null || y === null) break;
      ring.push([x, y]);
    }
    if (ring.length >= 3) return { type: "MultiPolygon", coordinates: [[ring]] };
  }

  return null;
}

function looksLikeFlatCoordinateSequence(value) {
  return Boolean(parseFlatCoordinateSequenceGeometry(value));
}

function findHeaderIndex(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeaderName);
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

function csvRowsToGeometry(rows, header) {
  const headers = header ? rows[0].map(normalizeHeaderName) : [];
  const dataRows = header ? rows.slice(1) : rows;

  const xIndex = header ? findHeaderIndex(headers, ["x", "coordx", "coordinatex", "utmx", "easting", "east", "est"]) : 0;
  const yIndex = header ? findHeaderIndex(headers, ["y", "coordy", "coordinatey", "utmy", "northing", "north", "nord"]) : 1;
  const orderIndex = header ? findHeaderIndex(headers, ["order", "ordre", "sequence", "seq", "index", "rang", "vertex", "sommet", "point"]) : -1;
  const polygonIndex = header ? findHeaderIndex(headers, ["polygon", "polygone", "polygonid", "polygoneid", "feature", "parcelle", "parcel", "idparcelle"]) : -1;
  const ringIndex = header ? findHeaderIndex(headers, ["ring", "anneau", "hole", "trou"]) : -1;

  if (xIndex < 0 || yIndex < 0) {
    throw new Error("Le CSV doit contenir deux colonnes X et Y en mètres EPSG:32628.");
  }

  const polygons = new Map();

  dataRows.forEach((row, rowIndex) => {
    if (!row.some((cell) => String(cell || "").trim())) return;

    const x = parseCsvNumber(row[xIndex]);
    const y = parseCsvNumber(row[yIndex]);
    if (x === null || y === null) {
      throw new Error(`Coordonnée CSV invalide à la ligne ${rowIndex + (header ? 2 : 1)}.`);
    }

    const polygonKey = polygonIndex >= 0 && row[polygonIndex] ? String(row[polygonIndex]).trim() : "1";
    const ringKey = ringIndex >= 0 && row[ringIndex] ? String(row[ringIndex]).trim() : "0";
    const order = orderIndex >= 0 ? parseCsvNumber(row[orderIndex]) : null;

    if (!polygons.has(polygonKey)) polygons.set(polygonKey, new Map());
    const rings = polygons.get(polygonKey);
    if (!rings.has(ringKey)) rings.set(ringKey, []);
    rings.get(ringKey).push({ x, y, order: order ?? rowIndex });
  });

  const coordinates = Array.from(polygons.values()).map((rings) =>
    Array.from(rings.values())
      .map((points) =>
        points
          .sort((a, b) => a.order - b.order)
          .map(({ x, y }) => [x, y]),
      )
      .filter((ring) => ring.length >= 3),
  ).filter((polygon) => polygon.length);

  if (!coordinates.length) {
    throw new Error("Le CSV doit contenir au moins 3 points exploitables pour créer un polygone.");
  }

  return { type: "MultiPolygon", coordinates };
}

export function parseCsvGeometry(text, options = {}) {
  const flatGeometry = parseFlatCoordinateSequenceGeometry(text);
  if (flatGeometry) {
    const normalizedFlatGeometry = normalizeToMultiPolygon(flatGeometry, options);
    if (normalizedFlatGeometry) return normalizedFlatGeometry;
  }

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) throw new Error("Le CSV est vide.");

  const delimiter = guessCsvDelimiter(lines);
  const rows = lines.map((line) => splitDelimitedLine(line, delimiter));

  if (rows[0].length < 2) {
    throw new Error("Le CSV doit contenir au moins deux colonnes : X et Y.");
  }

  const header = rows[0].some((cell) => !isNumericCell(cell));
  const rawGeometry = csvRowsToGeometry(rows, header);
  const normalized = normalizeToMultiPolygon(rawGeometry, options);

  if (!normalized) {
    throw new Error("Impossible de convertir le CSV en Polygon/MultiPolygon.");
  }

  return normalized;
}

/**
 * Parse une géométrie selon le format indiqué.
 *
 * Auto-détection : quel que soit le format sélectionné, si le texte ressemble
 * à une séquence de coordonnées simples (x,y;x,y;x,y ou x y\nx y\nx y),
 * il est traité comme CSV avant d'essayer le format déclaré.
 * Cela permet à l'utilisateur de coller ses coordonnées terrain directement
 * sans se soucier du format.
 */
export function parseGeometryByFormat(text, format, options = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Aucune géométrie à importer.");

  const normalizedFormat = String(format || "").toLowerCase();

  // Auto-détection : si le texte ressemble à une séquence de coordonnées simples,
  // on le traite comme CSV quelle que soit la sélection de format.
  // Ceci évite les erreurs quand l'utilisateur saisit "x,y;x,y" en mode GeoJSON.
  const flatGeom = parseFlatCoordinateSequenceGeometry(trimmed);
  if (flatGeom) {
    const normalized = normalizeToMultiPolygon(flatGeom, options);
    if (normalized) return normalized;
  }

  // Dispatch par format déclaré
  try {
    if (normalizedFormat === "csv") return parseCsvGeometry(trimmed, options);
    if (normalizedFormat === "kml") return parseKmlGeometry(trimmed);
    if (normalizedFormat === "wkt") return parseWktGeometry(trimmed, options);
    // GeoJSON par défaut (ou format inconnu → on tente GeoJSON)
    return parseGeoJsonGeometry(trimmed, options);
  } catch (primaryError) {
    // Fallback : si le format déclaré échoue, on tente les autres sauf KML
    if (normalizedFormat !== "csv") {
      try { return parseCsvGeometry(trimmed, options); } catch { /* ignore */ }
    }
    if (normalizedFormat !== "wkt") {
      try { return parseWktGeometry(trimmed, options); } catch { /* ignore */ }
    }
    if (normalizedFormat !== "geojson") {
      try { return parseGeoJsonGeometry(trimmed, options); } catch { /* ignore */ }
    }
    // Tous les parsers ont échoué — on re-lance l'erreur du parser déclaré
    throw primaryError;
  }
}

export function withProjectedCrsMetadata(geometry) {
  return {
    type: "Feature",
    properties: {
      crs: SENEGAL_PROJECTED_CRS,
      coordinate_unit: "metre",
    },
    geometry,
  };
}

export function downloadGeometryAsGeoJson(geometry, filename = "geometry-epsg32628.geojson") {
  const payload = JSON.stringify(withProjectedCrsMetadata(geometry), null, 2);
  const blob = new Blob([payload], { type: "application/geo+json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
