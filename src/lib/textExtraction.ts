import type { PDFPageProxy } from "pdfjs-dist";
import type { Sentence } from "../types";
import { hashString } from "./hash";

export type GlyphItem = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lineId: number;
  isVertical: boolean;
  columnIndex: number;
};

type Line = {
  id: number;
  y: number;
  items: GlyphItem[];
};

type Paragraph = {
  items: GlyphItem[];
};

type WritingMode = "horizontal" | "vertical";

function normalizeTextItems(page: PDFPageProxy, scale: number): Promise<GlyphItem[]> {
  return page.getTextContent().then((content) => {
    const viewport = page.getViewport({ scale });
    const items: GlyphItem[] = [];

    for (const item of content.items as any[]) {
      const text = String(item.str ?? "").trim();
      if (!text) continue;

      const transform = (window as any).pdfjsLib.Util.transform(viewport.transform, item.transform);
      const a = transform[0];
      const b = transform[1];
      const c = transform[2];
      const d = transform[3];
      const x = transform[4];
      const y = transform[5];
      const fontHeight = Math.hypot(transform[2], transform[3]);
      const w = item.width * viewport.scale;
      const h = fontHeight;
      const top = y - h;
      const isVertical = Math.abs(b) + Math.abs(c) > Math.abs(a) + Math.abs(d);

      items.push({ text, x, y: top, w, h, lineId: -1, isVertical, columnIndex: 0 });
    }

    return items;
  });
}

function detectColumnBoundaries(items: GlyphItem[], pageWidth: number): number[] {
  if (items.length === 0) return [0, pageWidth];

  // Collect all X positions (left edges) of text items
  const xPositions = items.map((item) => item.x).sort((a, b) => a - b);

  // Find gaps in X distribution that could indicate column boundaries
  const gapThreshold = pageWidth * 0.1; // 10% of page width
  const minColumnWidth = pageWidth * 0.15; // Minimum column width (15% of page)

  // Build histogram of X positions to find gaps
  const bucketSize = pageWidth / 50;
  const buckets: number[] = new Array(50).fill(0);

  for (const x of xPositions) {
    const bucketIndex = Math.min(49, Math.floor(x / bucketSize));
    buckets[bucketIndex]++;
  }

  // Find significant gaps (consecutive empty or low-density buckets)
  const boundaries: number[] = [0];
  let inGap = false;
  let gapStart = 0;

  for (let i = 1; i < buckets.length - 1; i++) {
    const isLowDensity = buckets[i] < items.length * 0.01; // Less than 1% of items

    if (isLowDensity && !inGap) {
      inGap = true;
      gapStart = i;
    } else if (!isLowDensity && inGap) {
      inGap = false;
      const gapWidth = (i - gapStart) * bucketSize;
      const gapCenter = (gapStart + i) / 2 * bucketSize;

      // Check if this gap is significant and creates reasonable column widths
      if (gapWidth >= gapThreshold) {
        const lastBoundary = boundaries[boundaries.length - 1];
        if (gapCenter - lastBoundary >= minColumnWidth) {
          boundaries.push(gapCenter);
        }
      }
    }
  }

  boundaries.push(pageWidth);

  // Verify we have reasonable columns (at least 2 with decent width)
  if (boundaries.length === 2) {
    return boundaries; // Single column layout
  }

  // Filter out columns that are too narrow
  const validBoundaries: number[] = [0];
  for (let i = 1; i < boundaries.length; i++) {
    const columnWidth = boundaries[i] - validBoundaries[validBoundaries.length - 1];
    if (columnWidth >= minColumnWidth || i === boundaries.length - 1) {
      validBoundaries.push(boundaries[i]);
    }
  }

  return validBoundaries;
}

function assignColumnsToItems(items: GlyphItem[], columnBoundaries: number[]): void {
  for (const item of items) {
    const itemCenter = item.x + item.w / 2;
    for (let i = 0; i < columnBoundaries.length - 1; i++) {
      if (itemCenter >= columnBoundaries[i] && itemCenter < columnBoundaries[i + 1]) {
        item.columnIndex = i;
        break;
      }
    }
  }
}

function groupItemsByColumn(items: GlyphItem[], numColumns: number): GlyphItem[][] {
  const columns: GlyphItem[][] = Array.from({ length: numColumns }, () => []);
  for (const item of items) {
    columns[item.columnIndex].push(item);
  }
  return columns;
}

function detectWritingMode(items: GlyphItem[]): WritingMode {
  if (items.length === 0) return "horizontal";
  const verticalCount = items.reduce((sum, item) => sum + (item.isVertical ? 1 : 0), 0);
  return verticalCount / items.length >= 0.4 ? "vertical" : "horizontal";
}

function groupIntoHorizontalLines(items: GlyphItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];

  for (const item of sorted) {
    const threshold = Math.max(2, item.h * 0.6);
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= threshold);
    if (!line) {
      line = { id: lines.length, y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    for (const item of line.items) {
      item.lineId = line.id;
    }
  }

  return lines.sort((a, b) => a.y - b.y);
}

function groupIntoVerticalColumns(items: GlyphItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  const columns: Line[] = [];

  for (const item of sorted) {
    const threshold = Math.max(2, item.w * 0.6);
    let column = columns.find((candidate) => Math.abs(candidate.y - item.x) <= threshold);
    if (!column) {
      column = { id: columns.length, y: item.x, items: [] };
      columns.push(column);
    }
    column.items.push(item);
    column.y = (column.y * (column.items.length - 1) + item.x) / column.items.length;
  }

  for (const column of columns) {
    column.items.sort((a, b) => a.y - b.y);
    for (const item of column.items) {
      item.lineId = column.id;
    }
  }

  return columns.sort((a, b) => b.y - a.y);
}

function groupIntoParagraphsHorizontal(lines: Line[]): Paragraph[] {
  if (lines.length === 0) return [];
  const avgHeight =
    lines.reduce((sum, line) => sum + line.items.reduce((h, item) => h + item.h, 0) / line.items.length, 0) /
    lines.length;
  const gapThreshold = Math.max(6, avgHeight * 1.6);

  const paragraphs: Paragraph[] = [];
  let current: Paragraph = { items: [] };
  let previousY = lines[0].y;

  for (const line of lines) {
    const gap = line.y - previousY;
    if (current.items.length > 0 && gap > gapThreshold) {
      paragraphs.push(current);
      current = { items: [] };
    }
    current.items.push(...line.items);
    previousY = line.y;
  }
  if (current.items.length > 0) {
    paragraphs.push(current);
  }

  return paragraphs;
}

function groupIntoParagraphsVertical(columns: Line[]): Paragraph[] {
  if (columns.length === 0) return [];
  const avgHeight =
    columns.reduce((sum, col) => sum + col.items.reduce((h, item) => h + item.h, 0) / col.items.length, 0) /
    columns.length;
  const gapThreshold = Math.max(6, avgHeight * 1.6);

  const paragraphs: Paragraph[] = [];
  let current: Paragraph = { items: [] };

  for (const column of columns) {
    let previousY = column.items.length > 0 ? column.items[0].y : 0;
    for (const item of column.items) {
      const gap = item.y - previousY;
      if (current.items.length > 0 && gap > gapThreshold) {
        paragraphs.push(current);
        current = { items: [] };
      }
      current.items.push(item);
      previousY = item.y;
    }
  }

  if (current.items.length > 0) {
    paragraphs.push(current);
  }

  return paragraphs;
}

function splitParagraphIntoSentences(paragraph: Paragraph): { text: string; items: GlyphItem[] }[] {
  const ranges: { item: GlyphItem; start: number; end: number }[] = [];
  let text = "";

  for (const item of paragraph.items) {
    if (text.length > 0 && !text.endsWith(" ")) {
      text += " ";
    }
    const start = text.length;
    text += item.text;
    ranges.push({ item, start, end: text.length });
  }

  const sentenceRegex = /[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g;
  const results: { text: string; items: GlyphItem[] }[] = [];
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    const end = match.index + raw.length;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const items = ranges
      .filter((range) => range.end > start && range.start < end)
      .map((range) => range.item);

    if (items.length > 0) {
      results.push({ text: trimmed, items });
    }
  }

  return results;
}

function buildSentenceRects(page: number, items: GlyphItem[]): { page: number; x: number; y: number; w: number; h: number }[] {
  const grouped = new Map<number, GlyphItem[]>();
  for (const item of items) {
    if (!grouped.has(item.lineId)) {
      grouped.set(item.lineId, []);
    }
    grouped.get(item.lineId)!.push(item);
  }

  const rects = Array.from(grouped.values()).map((lineItems) => {
    const minX = Math.min(...lineItems.map((item) => item.x));
    const minY = Math.min(...lineItems.map((item) => item.y));
    const maxX = Math.max(...lineItems.map((item) => item.x + item.w));
    const maxY = Math.max(...lineItems.map((item) => item.y + item.h));
    return {
      page,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    };
  });

  return rects;
}

export async function extractPageSentences(
  page: PDFPageProxy,
  docId: string,
  pageIndex: number
): Promise<Sentence[]> {
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;

  const glyphs = await normalizeTextItems(page, 1);
  const mode = detectWritingMode(glyphs);

  // For horizontal text, detect and handle multi-column layout
  if (mode === "horizontal") {
    const columnBoundaries = detectColumnBoundaries(glyphs, pageWidth);
    const numColumns = columnBoundaries.length - 1;

    if (numColumns > 1) {
      // Multi-column layout detected
      assignColumnsToItems(glyphs, columnBoundaries);
      const columnGroups = groupItemsByColumn(glyphs, numColumns);

      const sentences: Sentence[] = [];

      // Process each column separately, left to right
      for (const columnItems of columnGroups) {
        if (columnItems.length === 0) continue;

        const lines = groupIntoHorizontalLines(columnItems);
        const paragraphs = groupIntoParagraphsHorizontal(lines);

        for (const paragraph of paragraphs) {
          const sentenceParts = splitParagraphIntoSentences(paragraph);
          for (const part of sentenceParts) {
            const source = part.text;
            const hash = hashString(source);
            const sid = `${docId}:p${pageIndex + 1}:${hash}`;
            sentences.push({
              sid,
              page: pageIndex + 1,
              source,
              status: "idle",
              rects: buildSentenceRects(pageIndex + 1, part.items),
            });
          }
        }
      }

      return sentences;
    }
  }

  // Single column or vertical layout - use original logic
  const lines = mode === "vertical" ? groupIntoVerticalColumns(glyphs) : groupIntoHorizontalLines(glyphs);
  const paragraphs = mode === "vertical" ? groupIntoParagraphsVertical(lines) : groupIntoParagraphsHorizontal(lines);

  const sentences: Sentence[] = [];

  for (const paragraph of paragraphs) {
    const sentenceParts = splitParagraphIntoSentences(paragraph);
    for (const part of sentenceParts) {
      const source = part.text;
      const hash = hashString(source);
      const sid = `${docId}:p${pageIndex + 1}:${hash}`;
      sentences.push({
        sid,
        page: pageIndex + 1,
        source,
        status: "idle",
        rects: buildSentenceRects(pageIndex + 1, part.items),
      });
    }
  }

  return sentences;
}
