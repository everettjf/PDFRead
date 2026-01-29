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

  // Step 1: Group items into approximate lines by Y coordinate
  const lineThreshold = 10; // Items within 10px Y are on the same line
  const sortedByY = [...items].sort((a, b) => a.y - b.y);

  const lines: GlyphItem[][] = [];
  let currentLine: GlyphItem[] = [];
  let currentY = sortedByY[0]?.y ?? 0;

  for (const item of sortedByY) {
    if (currentLine.length === 0 || Math.abs(item.y - currentY) <= lineThreshold) {
      currentLine.push(item);
      // Update Y as running average
      currentY = currentLine.reduce((sum, i) => sum + i.y, 0) / currentLine.length;
    } else {
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [item];
      currentY = item.y;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Step 2: For each line, find horizontal gaps between items
  const gaps: { x: number; width: number }[] = [];
  const minGapWidth = pageWidth * 0.05; // At least 5% of page width to be a column gap

  for (const line of lines) {
    if (line.length < 2) continue;

    // Sort items in line by X position
    const sortedLine = [...line].sort((a, b) => a.x - b.x);

    for (let i = 0; i < sortedLine.length - 1; i++) {
      const current = sortedLine[i];
      const next = sortedLine[i + 1];
      const gapStart = current.x + current.w;
      const gapEnd = next.x;
      const gapWidth = gapEnd - gapStart;

      // Only consider significant gaps (not just word spacing)
      if (gapWidth > minGapWidth) {
        gaps.push({ x: (gapStart + gapEnd) / 2, width: gapWidth });
      }
    }
  }

  if (gaps.length === 0) {
    return [0, pageWidth]; // Single column
  }

  // Step 3: Cluster gaps by X position to find consistent column boundaries
  // Use a histogram approach with buckets
  const bucketSize = pageWidth / 100;
  const gapHistogram: number[] = new Array(100).fill(0);

  for (const gap of gaps) {
    const bucketIndex = Math.min(99, Math.max(0, Math.floor(gap.x / bucketSize)));
    gapHistogram[bucketIndex]++;
  }

  // Find peaks in the histogram (consistent gap positions across many lines)
  const minOccurrences = Math.max(3, lines.length * 0.15); // Gap must appear in at least 15% of lines
  const boundaries: number[] = [0];

  // Find contiguous regions with high gap counts
  let inPeak = false;
  let peakMax = 0;
  let peakMaxIndex = 0;

  for (let i = 0; i < gapHistogram.length; i++) {
    if (gapHistogram[i] >= minOccurrences) {
      if (!inPeak) {
        inPeak = true;
        peakMax = gapHistogram[i];
        peakMaxIndex = i;
      } else if (gapHistogram[i] > peakMax) {
        peakMax = gapHistogram[i];
        peakMaxIndex = i;
      }
    } else if (inPeak) {
      // End of peak - add boundary at peak center
      const boundaryX = (peakMaxIndex + 0.5) * bucketSize;
      boundaries.push(boundaryX);
      inPeak = false;
    }
  }

  // Handle peak at the end
  if (inPeak) {
    const boundaryX = (peakMaxIndex + 0.5) * bucketSize;
    boundaries.push(boundaryX);
  }

  boundaries.push(pageWidth);

  // Validate: columns should be at least 20% of page width
  const minColumnWidth = pageWidth * 0.2;
  const validBoundaries: number[] = [0];

  for (let i = 1; i < boundaries.length; i++) {
    const columnWidth = boundaries[i] - validBoundaries[validBoundaries.length - 1];
    if (columnWidth >= minColumnWidth || i === boundaries.length - 1) {
      if (i < boundaries.length - 1) {
        validBoundaries.push(boundaries[i]);
      }
    }
  }
  validBoundaries.push(pageWidth);

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

function splitIntoSentences(text: string, ranges: { item: GlyphItem; start: number; end: number }[]): { text: string; items: GlyphItem[] }[] {
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

function mergeParagraphsIntoSentences(paragraphs: Paragraph[]): { text: string; items: GlyphItem[] }[] {
  if (paragraphs.length === 0) return [];

  // First, build full text and ranges from all paragraphs
  const allRanges: { item: GlyphItem; start: number; end: number }[] = [];
  let fullText = "";

  for (const paragraph of paragraphs) {
    for (const item of paragraph.items) {
      if (fullText.length > 0 && !fullText.endsWith(" ")) {
        fullText += " ";
      }
      const start = fullText.length;
      fullText += item.text;
      allRanges.push({ item, start, end: fullText.length });
    }
  }

  // Split into sentences using the full text
  return splitIntoSentences(fullText, allRanges);
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

        // Merge all paragraphs into complete sentences
        const sentenceParts = mergeParagraphsIntoSentences(paragraphs);
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
  }

  // Single column or vertical layout - use original logic
  const lines = mode === "vertical" ? groupIntoVerticalColumns(glyphs) : groupIntoHorizontalLines(glyphs);
  const paragraphs = mode === "vertical" ? groupIntoParagraphsVertical(lines) : groupIntoParagraphsHorizontal(lines);

  // Merge all paragraphs into complete sentences
  const sentenceParts = mergeParagraphsIntoSentences(paragraphs);
  const sentences: Sentence[] = [];

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

  return sentences;
}
