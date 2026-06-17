import round from "lodash/round";
import { convertUnits, type Units, type Shape } from "./shape";
import { parseShapeParams, type ShapeParams } from "./shapeParams";

export const LS_KEY = "slabforge:lastDesign";

export const DEFAULT_PARAMS: ShapeParams = {
  sides: 4,
  height: 5,
  bottomWidth: 5,
  topWidth: 5,
  clayThickness: 0.25,
  seamMode: "sides",
  units: "in",
  pageSize: "letter",
};

// The single canonical serializer; the editor's export query and download links
// both route through this so the URL, localStorage, and downloads stay in sync.
export function serializeDesign(p: ShapeParams): string {
  return new URLSearchParams({
    sides: String(p.sides),
    height: String(p.height),
    bottomWidth: String(p.bottomWidth),
    topWidth: String(p.topWidth),
    clayThickness: String(p.clayThickness),
    seamMode: p.seamMode,
    units: p.units,
    pageSize: p.pageSize,
  }).toString();
}

// Lenient wrapper around the strict endpoint parser: null instead of throwing.
export function parseDesignQuery(qs: string): ShapeParams | null {
  try {
    return parseShapeParams(new URLSearchParams(qs));
  } catch {
    return null;
  }
}

// Resolve the initial design: URL params, then localStorage, then defaults.
// Reads localStorage, so it must run client-side only (the /edit route is ssr=false).
export function loadDesign(url: URL): ShapeParams {
  if (url.searchParams.has("sides")) {
    try {
      return parseShapeParams(url.searchParams);
    } catch {
      // fall through to localStorage / defaults
    }
  }
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const parsed = parseDesignQuery(saved);
      if (parsed) return parsed;
    }
  } catch {
    // localStorage unavailable; ignore
  }
  return { ...DEFAULT_PARAMS };
}

// Unit conversion rounded to enough precision that in<->cm round-trips are stable.
export function convertValue(q: number, from: Units, to: Units): number {
  return round(convertUnits(q, from, to), 4);
}

// US Letter is 612x792 pt; the PDF endpoint uses PDFDocument({ margin: 36 }),
// leaving 540x720 pt of content per page.
const LETTER_CONTENT_WIDTH_PT = 540;
const LETTER_CONTENT_HEIGHT_PT = 720;

export function estimatePageCount(shape: Shape, units: Units, pageSize: string): number {
  if (pageSize === "auto") return 1;
  const scale = convertUnits(1, units, "pt");
  const b = shape.calcPDFBounds();
  const minWidth = (b.right - b.left) * scale;
  const minHeight = (b.bottom - b.top) * scale;
  return Math.ceil(minWidth / LETTER_CONTENT_WIDTH_PT) * Math.ceil(minHeight / LETTER_CONTENT_HEIGHT_PT);
}
