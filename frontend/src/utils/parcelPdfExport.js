import jsPDF from "jspdf";

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function formatNumber(value, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(number)}${suffix}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function safeFileName(value) {
  return String(value || "parcelle")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function addSectionTitle(doc, title, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(18, 59, 93);
  doc.text(title, 20, y);
  doc.setDrawColor(199, 178, 153);
  doc.line(20, y + 3, 190, y + 3);
  return y + 10;
}

function addKeyValue(doc, label, value, x, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90, 104, 118);
  doc.text(label, x, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(22, 35, 48);
  doc.text(valueOrDash(value), x, y + 5, { maxWidth: 78 });

  return y + 14;
}

function addParagraph(doc, text, x, y, maxWidth = 170) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(35, 45, 55);
  const lines = doc.splitTextToSize(valueOrDash(text), maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * 5 + 4;
}

export function exportParcelDetailPdf(parcel = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const reference = parcel.reference || parcel.title_number || `Parcelle ${parcel.id || ""}`.trim();
  const owner = parcel.owner_name || parcel.owner_client_code || "—";
  const organization = parcel.organization_name || parcel.organization_code || "—";
  const location = parcel.location || parcel.commune || parcel.village || "—";
  const status = parcel.status_label || parcel.status || "—";
  const progress = parcel.progress ?? null;
  const area = parcel.computed_area ?? parcel.area;
  const perimeter = parcel.computed_perimeter ?? parcel.perimeter;

  doc.setFillColor(18, 59, 93);
  doc.rect(0, 0, 210, 32, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("MAPGEO", 20, 14);

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Fiche parcelle", 20, 23);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(valueOrDash(reference), 105, 18, { align: "center", maxWidth: 90 });

  let y = 44;

  y = addSectionTitle(doc, "Identification", y);
  const yStart = y;
  addKeyValue(doc, "Référence", reference, 20, y);
  addKeyValue(doc, "Client", owner, 110, y);
  y += 14;
  addKeyValue(doc, "Organisation", organization, 20, y);
  addKeyValue(doc, "NICAD", parcel.nicad || parcel.parcel_number, 110, y);
  y += 18;

  y = Math.max(y, yStart + 34);

  y = addSectionTitle(doc, "Localisation et surfaces", y);
  addKeyValue(doc, "Localisation", location, 20, y);
  addKeyValue(doc, "Commune", parcel.commune, 110, y);
  y += 14;
  addKeyValue(doc, "Surface", formatNumber(area, " m²"), 20, y);
  addKeyValue(doc, "Périmètre", formatNumber(perimeter, " m"), 110, y);
  y += 18;

  y = addSectionTitle(doc, "Avancement du dossier", y);
  addKeyValue(doc, "Statut", status, 20, y);
  addKeyValue(doc, "Progression", progress === null || progress === undefined ? "—" : `${Math.round(Number(progress))} %`, 110, y);
  y += 18;

  const timeline = Array.isArray(parcel.timeline_events) ? parcel.timeline_events.slice(-4) : [];
  if (timeline.length) {
    y = addSectionTitle(doc, "Dernières étapes", y);
    timeline.forEach((event) => {
      if (y > 265) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(18, 59, 93);
      doc.text(`${formatDate(event.event_date)} · ${valueOrDash(event.title)}`, 20, y);
      y += 5;
      if (event.description) {
        y = addParagraph(doc, event.description, 24, y, 160);
      } else {
        y += 3;
      }
    });
  }

  const documents = Array.isArray(parcel.documents) ? parcel.documents : [];
  if (documents.length) {
    if (y > 245) {
      doc.addPage();
      y = 20;
    }
    y = addSectionTitle(doc, "Plans, rapports et livrables", y);
    documents.slice(0, 6).forEach((item) => {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(35, 45, 55);
      doc.text(`• ${valueOrDash(item.title || item.name || `Livrable ${item.id}`)}`, 22, y, { maxWidth: 165 });
      y += 6;
    });
  }

  if (parcel.notes) {
    if (y > 245) {
      doc.addPage();
      y = 20;
    }
    y = addSectionTitle(doc, "Notes", y);
    y = addParagraph(doc, parcel.notes, 20, y, 170);
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 130, 140);
    doc.text(`Généré par MAPGEO · ${new Date().toLocaleDateString("fr-FR")}`, 20, 288);
    doc.text(`Page ${page}/${pageCount}`, 190, 288, { align: "right" });
  }

  doc.save(`fiche-parcelle-${safeFileName(reference)}.pdf`);
}
