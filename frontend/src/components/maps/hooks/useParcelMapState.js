import { useMemo, useState } from "react";

export default function useParcelMapState(sigLayers) {
  const [baseLayer, setBaseLayer] = useState("vector");
  const [showVertices, setShowVertices] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [showExternalLayers, setShowExternalLayers] = useState(Array.isArray(sigLayers) && sigLayers.length > 0);
  const [activePanel, setActivePanel] = useState("documents");
  const [map, setMap] = useState(null);

  const hasExternalLayers = useMemo(
    () => Array.isArray(sigLayers) && sigLayers.length > 0,
    [sigLayers],
  );

  return {
    baseLayer,
    setBaseLayer,
    showVertices,
    setShowVertices,
    showMeasurements,
    setShowMeasurements,
    showExternalLayers,
    setShowExternalLayers,
    activePanel,
    setActivePanel,
    map,
    setMap,
    hasExternalLayers,
  };
}
