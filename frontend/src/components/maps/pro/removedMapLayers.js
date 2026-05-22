function normalizeRemovedLayerText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isRemovedCommunesLayer(layer = {}) {
  const metadata = layer.metadata && typeof layer.metadata === "object" ? layer.metadata : {};

  const values = [
    layer.id,
    layer.layerId,
    layer.sourceLayerId,
    layer.name,
    layer.title,
    layer.shortName,
    layer.label,
    layer.endpoint,
    layer.url,
    layer.layers,
    layer.service_layers,
    layer.serviceLayers,
    layer.postgis_table,
    layer.postgisTable,
    layer.table,
    layer.source,
    layer.sourceTable,
    layer.source_table,
    layer.clientLayerType,
    layer.layerType,
    layer.dataFormat,
    metadata.id,
    metadata.layerId,
    metadata.sourceLayerId,
    metadata.name,
    metadata.title,
    metadata.label,
    metadata.endpoint,
    metadata.url,
    metadata.layers,
    metadata.service_layers,
    metadata.serviceLayers,
    metadata.postgis_table,
    metadata.postgisTable,
    metadata.table,
    metadata.source,
    metadata.sourceTable,
    metadata.source_table,
  ].map(normalizeRemovedLayerText).filter(Boolean);

  return values.some((value) =>
    value === "commune" ||
    value === "communes" ||
    value === "limites communales" ||
    value === "limite communale" ||
    value === "communes administratives" ||
    value.includes("/map/communes/") ||
    value.includes("table=communes") ||
    value.includes("postgis_table=communes")
  );
}
