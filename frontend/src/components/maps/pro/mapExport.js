import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const MIME_BY_FORMAT = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  geojson: "application/geo+json",
};

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function canvasToBlob(canvas, type = "image/png", quality = 0.92) {
  return new Promise((resolve) => {
    if (!canvas?.toBlob) {
      resolve(dataUrlToBlob(canvas.toDataURL(type, quality)));
      return;
    }
    canvas.toBlob((blob) => resolve(blob || dataUrlToBlob(canvas.toDataURL(type, quality))), type, quality);
  });
}

async function saveBlob(blob, filename, options = {}) {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const mime = options.mimeType || MIME_BY_FORMAT[extension] || blob.type || "application/octet-stream";

  if (options.useSavePicker && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: options.description || "Export MapGeo",
            accept: { [mime]: [`.${extension || "dat"}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(dataUrl, filename, options = {}) {
  return saveBlob(dataUrlToBlob(dataUrl), filename, options);
}

export function safeFileName(value, fallback = "carte-sig") {
  return String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || fallback;
}

async function captureMapCanvas(element, options = {}) {
  if (!element) return null;
  const target = options.captureFullLayout ? element : element.querySelector?.(".leaflet-container") || element;
  const shouldHideInterface = options.hideInterface !== false;
  if (shouldHideInterface) element.classList.add("mapgeo-exporting");

  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return await html2canvas(target, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: options.backgroundColor || "#ffffff",
      scale: Number(options.resolutionScale || options.scale || 2) || 2,
      logging: false,
      width: options.width,
      height: options.height,
    });
  } finally {
    if (shouldHideInterface) element.classList.remove("mapgeo-exporting");
  }
}

function hexToRgb(value, fallback = [18, 59, 93]) {
  const hex = String(value || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function fitImage(width, height, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: width * ratio,
    height: height * ratio,
  };
}

function drawNorthArrow(pdf, x, y) {
  pdf.setDrawColor(18, 59, 93);
  pdf.setFillColor(18, 59, 93);
  pdf.triangle(x, y, x - 4, y + 12, x + 4, y + 12, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("N", x, y - 2, { align: "center" });
}

function drawScaleBar(pdf, x, y, label = "Échelle graphique") {
  pdf.setDrawColor(18, 59, 93);
  pdf.setLineWidth(0.35);
  pdf.line(x, y, x + 42, y);
  pdf.line(x, y - 2, x, y + 2);
  pdf.line(x + 21, y - 2, x + 21, y + 2);
  pdf.line(x + 42, y - 2, x + 42, y + 2);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text(label, x, y + 6);
}

function drawLegend(pdf, legendItems, x, y, maxWidth) {
  if (!legendItems?.length) return y;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(18, 59, 93);
  pdf.text("Légende", x, y);
  let cursorY = y + 6;

  legendItems.slice(0, 16).forEach((item) => {
    const color = item.color || "#123B5D";
    const fill = item.fillColor || item.color || "#ffffff";
    pdf.setDrawColor(...hexToRgb(color));
    pdf.setFillColor(...hexToRgb(fill, [255, 255, 255]));
    if (item.symbol === "line") {
      pdf.line(x, cursorY + 2, x + 9, cursorY + 2);
    } else if (item.symbol === "point") {
      pdf.circle(x + 4, cursorY + 2, 2, "FD");
    } else {
      pdf.roundedRect(x, cursorY - 1, 9, 5, 1, 1, "FD");
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(30, 41, 59);
    const lines = pdf.splitTextToSize(item.label || "Symbole", Math.max(20, maxWidth - 14));
    pdf.text(lines.slice(0, 2), x + 13, cursorY + 2);
    cursorY += Math.max(6, lines.length * 3.6);
  });

  return cursorY;
}

function drawSummaryTable(pdf, rows, x, y, width, maxRows = 12) {
  if (!rows?.length) return y;
  const rowHeight = 7.5;
  let cursorY = y;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(18, 59, 93);
  pdf.text("Synthèse parcellaire", x, cursorY);
  cursorY += 5;

  rows.slice(0, maxRows).forEach(([label, value], index) => {
    const fill = index % 2 === 0 ? 248 : 255;
    pdf.setFillColor(fill, fill, fill);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(x, cursorY, width, rowHeight, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.2);
    pdf.setTextColor(71, 85, 105);
    pdf.text(String(label || "—"), x + 2, cursorY + 5);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(15, 23, 42);
    const valueText = pdf.splitTextToSize(String(value || "—"), width * 0.48);
    pdf.text(valueText.slice(0, 1), x + width * 0.5, cursorY + 5);
    cursorY += rowHeight;
  });
  return cursorY;
}

function drawCanvasNorthArrow(ctx, x, y, color = "#123B5D") {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 10, y + 36);
  ctx.lineTo(x, y + 29);
  ctx.lineTo(x + 10, y + 36);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 17px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", x, y - 8);
  ctx.restore();
}

function drawCanvasScaleBar(ctx, x, y, label = "Échelle graphique") {
  ctx.save();
  ctx.strokeStyle = "#123B5D";
  ctx.fillStyle = "#123B5D";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 150, y);
  ctx.stroke();
  [0, 75, 150].forEach((offset) => {
    ctx.beginPath();
    ctx.moveTo(x + offset, y - 8);
    ctx.lineTo(x + offset, y + 8);
    ctx.stroke();
  });
  ctx.font = "600 14px Inter, Arial, sans-serif";
  ctx.fillText(label || "Échelle graphique", x, y + 28);
  ctx.restore();
}

function drawCanvasLegend(ctx, legendItems, x, y, width) {
  if (!legendItems?.length) return y;
  ctx.save();
  ctx.fillStyle = "#123B5D";
  ctx.font = "800 18px Inter, Arial, sans-serif";
  ctx.fillText("Légende", x, y);
  let cursorY = y + 24;

  legendItems.slice(0, 12).forEach((item) => {
    const fill = item.fillColor || item.color || "#ffffff";
    const stroke = item.color || "#123B5D";
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineWidth = 2;
    if (item.symbol === "line") {
      ctx.beginPath();
      ctx.moveTo(x, cursorY - 2);
      ctx.lineTo(x + 24, cursorY - 2);
      ctx.stroke();
    } else if (item.symbol === "point") {
      ctx.beginPath();
      ctx.arc(x + 12, cursorY - 2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x, cursorY - 10, 24, 14);
      ctx.strokeRect(x, cursorY - 10, 24, 14);
    }
    ctx.fillStyle = "#123B5D";
    ctx.font = "600 13px Inter, Arial, sans-serif";
    const label = String(item.label || "Symbole");
    const text = label.length > 38 ? `${label.slice(0, 35)}…` : label;
    ctx.fillText(text, x + 34, cursorY + 2, width - 38);
    cursorY += 22;
  });
  ctx.restore();
  return cursorY;
}

function buildImageSummaryText(rows = []) {
  return rows
    .filter((row) => row?.[0] && row?.[1])
    .slice(0, 5)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" · ");
}

function composeProfessionalImage(mapCanvas, options = {}) {
  const includeHeader = options.includeTitle !== false;
  const includeFooter = options.includeDate !== false || options.includeReference !== false || options.author || options.summaryRows?.length;
  const includeSide = options.includeLegend !== false && options.legendItems?.length;
  const padding = 28;
  const headerHeight = includeHeader ? 84 : padding;
  const footerHeight = includeFooter ? 54 : padding;
  const sideWidth = includeSide ? 280 : 0;
  const width = mapCanvas.width + padding * 2 + sideWidth;
  const height = mapCanvas.height + headerHeight + footerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (includeHeader) {
    ctx.fillStyle = "#123B5D";
    ctx.font = "800 28px Inter, Arial, sans-serif";
    ctx.fillText(options.title || "Carte parcellaire", padding, 38);
    ctx.fillStyle = "#123B5D";
    ctx.font = "600 15px Inter, Arial, sans-serif";
    const headerParts = [
      options.reference ? `Référence : ${options.reference}` : null,
      options.author ? `Auteur : ${options.author}` : null,
      options.includeDate !== false ? `Date : ${new Date().toLocaleDateString("fr-FR")}` : null,
      options.scale ? `Échelle : ${options.scale}` : null,
    ].filter(Boolean);
    ctx.fillText(headerParts.join(" · "), padding, 64, width - padding * 2);
  }

  const mapX = padding;
  const mapY = headerHeight;
  ctx.strokeStyle = "#F7F5F2";
  ctx.lineWidth = 2;
  ctx.strokeRect(mapX - 1, mapY - 1, mapCanvas.width + 2, mapCanvas.height + 2);
  ctx.drawImage(mapCanvas, mapX, mapY);

  if (options.includeNorth !== false) drawCanvasNorthArrow(ctx, mapX + mapCanvas.width - 46, mapY + 42);
  if (options.includeScale !== false) drawCanvasScaleBar(ctx, mapX + 30, mapY + mapCanvas.height - 42, options.scale || "Échelle indicative");

  if (includeSide) {
    const sideX = mapX + mapCanvas.width + padding;
    ctx.fillStyle = "#F7F5F2";
    ctx.strokeStyle = "#D8CABB";
    ctx.lineWidth = 2;
    ctx.fillRect(sideX - 14, mapY, sideWidth - 6, mapCanvas.height);
    ctx.strokeRect(sideX - 14, mapY, sideWidth - 6, mapCanvas.height);
    drawCanvasLegend(ctx, options.legendItems || [], sideX, mapY + 32, sideWidth - 38);
  }

  if (includeFooter) {
    const footerText = [
      buildImageSummaryText(options.summaryRows),
      "Export généré depuis MapGeo · document cartographique non cadastral sans validation administrative",
    ].filter(Boolean).join("  —  ");
    ctx.fillStyle = "#C7B299";
    ctx.font = "600 13px Inter, Arial, sans-serif";
    ctx.fillText(footerText, padding, height - 22, width - padding * 2);
  }

  return canvas;
}

export async function exportMapAsPng(element, title = "Carte SIG", options = {}) {
  if (!element) return;
  const mapCanvas = await captureMapCanvas(element, options);
  if (!mapCanvas) return;
  const canvas = options.professionalLayout === false ? mapCanvas : composeProfessionalImage(mapCanvas, { ...options, title });
  const filename = `${safeFileName(options.fileName || title)}.png`;
  await saveBlob(await canvasToBlob(canvas, "image/png"), filename, { useSavePicker: options.useSavePicker, mimeType: "image/png", description: "Image PNG" });
}

export async function exportMapAsJpeg(element, title = "Carte SIG", options = {}) {
  if (!element) return;
  const mapCanvas = await captureMapCanvas(element, options);
  if (!mapCanvas) return;
  const canvas = options.professionalLayout === false ? mapCanvas : composeProfessionalImage(mapCanvas, { ...options, title });
  const filename = `${safeFileName(options.fileName || title)}.jpg`;
  await saveBlob(await canvasToBlob(canvas, "image/jpeg", Number(options.jpegQuality || 0.92)), filename, { useSavePicker: options.useSavePicker, mimeType: "image/jpeg", description: "Image JPEG" });
}

export async function exportProfessionalMapImage(element, options = {}) {
  const format = options.outputFormat === "jpeg" || options.outputFormat === "jpg" ? "jpeg" : "png";
  if (format === "jpeg") return exportMapAsJpeg(element, options.title || "Carte SIG", options);
  return exportMapAsPng(element, options.title || "Carte SIG", options);
}

export async function exportGeometryAsGeoJson(featureOrGeometry, title = "parcelle", options = {}) {
  const geometry = featureOrGeometry?.geometry || featureOrGeometry;
  if (!geometry) return;
  const payload = {
    type: "Feature",
    properties: {
      ...(featureOrGeometry?.properties || {}),
      crs: "EPSG:32628",
      coordinate_unit: "metre",
    },
    geometry,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/geo+json;charset=utf-8" });
  await saveBlob(blob, `${safeFileName(options.fileName || title)}.geojson`, { useSavePicker: options.useSavePicker, mimeType: "application/geo+json", description: "GeoJSON" });
}

export async function exportMapAsPdf(element, title = "Carte SIG") {
  return exportProfessionalMapPdf(element, {
    title,
    format: "a4",
    orientation: "landscape",
    includeLegend: true,
    includeNorth: true,
    includeDate: true,
  });
}

export async function exportProfessionalMapPdf(element, options = {}) {
  if (!element) return;

  const format = String(options.format || "a4").toLowerCase();
  const orientation = options.orientation || "landscape";
  const pdf = new jsPDF({ orientation, unit: "mm", format });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const sidebarWidth = options.includeLegend !== false || (options.includeSummary !== false && options.summaryRows?.length) ? 76 : 0;
  const headerHeight = 22;
  const footerHeight = 10;
  const mapX = margin;
  const mapY = margin + headerHeight;
  const mapMaxWidth = pageWidth - margin * 2 - sidebarWidth - (sidebarWidth ? 6 : 0);
  const mapMaxHeight = pageHeight - margin * 2 - headerHeight - footerHeight;

  const canvas = await captureMapCanvas(element, { ...options, scale: options.resolutionScale || options.scale || 2 });
  if (!canvas) return;
  const image = canvas.toDataURL("image/png");
  const fitted = fitImage(canvas.width, canvas.height, mapMaxWidth, mapMaxHeight);

  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");

  if (options.includeTitle !== false) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(18, 59, 93);
    pdf.text(options.title || "Carte parcellaire", margin, margin + 5);
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(71, 85, 105);
  const headerParts = [
    options.reference ? `Référence : ${options.reference}` : null,
    options.author ? `Auteur : ${options.author}` : null,
    options.includeDate !== false ? `Date : ${new Date().toLocaleDateString("fr-FR")}` : null,
    options.scale ? `Échelle : ${options.scale}` : null,
  ].filter(Boolean);
  pdf.text(headerParts.join(" · "), margin, margin + 12);

  pdf.setDrawColor(203, 213, 225);
  pdf.roundedRect(mapX, mapY, fitted.width, fitted.height, 1.5, 1.5, "S");
  pdf.addImage(image, "PNG", mapX, mapY, fitted.width, fitted.height);

  if (options.includeNorth !== false) drawNorthArrow(pdf, mapX + fitted.width - 12, mapY + 10);
  if (options.includeScale !== false) drawScaleBar(pdf, mapX + 8, mapY + fitted.height - 10, options.scale || "Échelle indicative");

  if (sidebarWidth) {
    const sideX = mapX + mapMaxWidth + 6;
    let sideY = mapY;
    pdf.setDrawColor(226, 232, 240);
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(sideX, sideY, sidebarWidth, mapMaxHeight, 2, 2, "FD");

    if (options.includeLegend !== false) {
      sideY = drawLegend(pdf, options.legendItems || [], sideX + 4, sideY + 8, sidebarWidth - 8) + 5;
    }

    if (options.includeSummary !== false && options.summaryRows?.length) {
      drawSummaryTable(pdf, options.summaryRows, sideX + 4, sideY + 4, sidebarWidth - 8, format === "a3" ? 16 : 12);
    }
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Export généré depuis MapGeo · document cartographique non cadastral sans validation administrative", margin, pageHeight - 5);

  const filename = `${safeFileName(options.fileName || options.title || "carte-parcelle")}.pdf`;
  if (options.useSavePicker) {
    const blob = pdf.output("blob");
    await saveBlob(blob, filename, { useSavePicker: true, mimeType: "application/pdf", description: "Document PDF" });
  } else {
    pdf.save(filename);
  }
}
