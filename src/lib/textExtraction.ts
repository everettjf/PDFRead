import type { PDFPageProxy } from "pdfjs-dist";
import type { Paragraph } from "../types";
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
  rotation: number;
};

type Line = {
  id: number;
  y: number;
  items: GlyphItem[];
};

type TextBlock = {
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

      // Calculate rotation angle from transform matrix
      const rotation = Math.atan2(b, a) * (180 / Math.PI);

      items.push({ text, x, y: top, w, h, lineId: -1, isVertical, columnIndex: 0, rotation });
    }

    return items;
  });
}

// Common watermark patterns to filter out
const WATERMARK_PATTERNS = [
  /^(educational|sample|draft|confidential|watermark|preview|demo)$/i,
  /^(educational\s*sample|sample\s*copy|not\s*for\s*distribution)$/i,
];

function isWatermarkText(item: GlyphItem): boolean {
  // Check if text matches common watermark patterns
  const text = item.text.toLowerCase();
  for (const pattern of WATERMARK_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  // Check if text is significantly rotated (watermarks are often diagonal)
  const absRotation = Math.abs(item.rotation);
  if (absRotation > 10 && absRotation < 170) {
    // Rotated text that's not horizontal
    return true;
  }

  return false;
}

function filterWatermarks(items: GlyphItem[]): { content: GlyphItem[]; watermarks: GlyphItem[] } {
  const content: GlyphItem[] = [];
  const watermarks: GlyphItem[] = [];

  for (const item of items) {
    if (isWatermarkText(item)) {
      watermarks.push(item);
    } else {
      content.push(item);
    }
  }

  return { content, watermarks };
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

function getLineText(line: Line): string {
  const sorted = [...line.items].sort((a, b) => a.x - b.x);
  return sorted.map((item) => item.text).join(" ");
}

function groupIntoParagraphsHorizontal(lines: Line[]): TextBlock[] {
  if (lines.length === 0) return [];

  // Calculate average line height
  const avgHeight =
    lines.reduce((sum, line) => sum + line.items.reduce((h, item) => h + item.h, 0) / line.items.length, 0) /
    lines.length;

  // Get the leftmost X position of each line
  const lineStarts = lines.map((line) => {
    const sorted = [...line.items].sort((a, b) => a.x - b.x);
    return sorted[0]?.x ?? 0;
  });

  // Get line widths (rightmost - leftmost)
  const lineWidths = lines.map((line) => {
    if (line.items.length === 0) return 0;
    const sorted = [...line.items].sort((a, b) => a.x - b.x);
    const left = sorted[0].x;
    const right = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w;
    return right - left;
  });

  // Find the most common left margin (baseline for non-indented lines)
  const sortedStarts = [...lineStarts].sort((a, b) => a - b);
  const baselineX = sortedStarts[Math.floor(sortedStarts.length * 0.15)] ?? 0;

  // Calculate average line width to detect short lines
  const avgWidth = lineWidths.reduce((sum, w) => sum + w, 0) / lineWidths.length;

  // Indentation threshold - if a line starts significantly to the right of baseline, it's indented
  const indentThreshold = avgHeight * 1.2;

  // Vertical gap thresholds - increased to be less aggressive
  const normalGapThreshold = avgHeight * 1.8;
  const largeGapThreshold = avgHeight * 2.5;

  const blocks: TextBlock[] = [];
  let current: TextBlock = { items: [] };
  let previousY = lines[0].y;
  let previousLineText = "";
  let previousLineWidth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = lineStarts[i];
    const lineWidth = lineWidths[i];
    const lineText = getLineText(line);
    const verticalGap = line.y - previousY;

    // Check various conditions for a new paragraph
    let isNewParagraph = false;

    if (current.items.length > 0) {
      // Check if this line clearly continues the previous sentence
      // (previous doesn't end with sentence punctuation AND current starts with lowercase or continues)
      const prevEndsSentence = /[.!?]["'"']?\s*$/.test(previousLineText);
      const currentStartsLowercase = /^[a-z]/.test(lineText.trim());
      const currentContinuesSentence = /^(the|a|an|and|or|but|in|on|at|to|for|of|with|that|this|it|is|was|were|are|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|must|shall)\s/i.test(lineText.trim());

      // If previous line doesn't end a sentence and current continues, don't split
      const isContinuation = !prevEndsSentence && (currentStartsLowercase || currentContinuesSentence);

      if (isContinuation) {
        // Don't start a new paragraph - this is a continuation
        isNewParagraph = false;
      } else {
        // 1. Line is indented (starts significantly to the right of baseline)
        const isIndented = lineStart > baselineX + indentThreshold;

        // 2. Very large vertical gap between lines
        const hasLargeGap = verticalGap > largeGapThreshold;

        // 3. Moderate gap + previous line ended with sentence-ending punctuation
        const hasMediumGap = verticalGap > normalGapThreshold;

        // 4. Line starts with quotation mark (dialogue) after sentence end
        const startsWithQuote = /^["'"'「『]/.test(lineText.trim());

        // 5. Previous line was significantly shorter AND ended sentence
        const prevWasShort = previousLineWidth < avgWidth * 0.65;

        // 6. Line starts with capital letter after previous ended with punctuation
        const startsWithCapital = /^[A-Z]/.test(lineText.trim());

        // Determine if this is a new paragraph - be more conservative
        if (isIndented && prevEndsSentence) {
          isNewParagraph = true;
        } else if (hasLargeGap && prevEndsSentence) {
          isNewParagraph = true;
        } else if (hasMediumGap && prevEndsSentence && startsWithCapital) {
          isNewParagraph = true;
        } else if (startsWithQuote && prevEndsSentence && hasMediumGap) {
          isNewParagraph = true;
        } else if (prevWasShort && prevEndsSentence && startsWithCapital && hasMediumGap) {
          isNewParagraph = true;
        }
      }
    }

    if (isNewParagraph) {
      blocks.push(current);
      current = { items: [] };
    }

    current.items.push(...line.items);
    previousY = line.y;
    previousLineText = lineText;
    previousLineWidth = lineWidth;
  }

  if (current.items.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function groupIntoParagraphsVertical(columns: Line[]): TextBlock[] {
  if (columns.length === 0) return [];
  const avgHeight =
    columns.reduce((sum, col) => sum + col.items.reduce((h, item) => h + item.h, 0) / col.items.length, 0) /
    columns.length;
  const gapThreshold = Math.max(6, avgHeight * 1.6);

  const blocks: TextBlock[] = [];
  let current: TextBlock = { items: [] };

  for (const column of columns) {
    let previousY = column.items.length > 0 ? column.items[0].y : 0;
    for (const item of column.items) {
      const gap = item.y - previousY;
      if (current.items.length > 0 && gap > gapThreshold) {
        blocks.push(current);
        current = { items: [] };
      }
      current.items.push(item);
      previousY = item.y;
    }
  }

  if (current.items.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function buildParagraphText(block: TextBlock): { text: string; items: GlyphItem[] } {
  let text = "";

  for (const item of block.items) {
    if (text.length > 0 && !text.endsWith(" ")) {
      text += " ";
    }
    text += item.text;
  }

  return { text: text.trim(), items: block.items };
}

function buildParagraphRects(page: number, items: GlyphItem[]): { page: number; x: number; y: number; w: number; h: number }[] {
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

export type PageExtractionResult = {
  paragraphs: Paragraph[];
  watermarks: string[];
};

export async function extractPageParagraphs(
  page: PDFPageProxy,
  docId: string,
  pageIndex: number
): Promise<PageExtractionResult> {
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;

  const allGlyphs = await normalizeTextItems(page, 1);

  // Filter out watermarks
  const { content: glyphs, watermarks: watermarkItems } = filterWatermarks(allGlyphs);
  const watermarks = watermarkItems.map((item) => item.text);

  const mode = detectWritingMode(glyphs);
  const paragraphs: Paragraph[] = [];

  // For horizontal text, detect and handle multi-column layout
  if (mode === "horizontal") {
    const columnBoundaries = detectColumnBoundaries(glyphs, pageWidth);
    const numColumns = columnBoundaries.length - 1;

    if (numColumns > 1) {
      // Multi-column layout detected
      assignColumnsToItems(glyphs, columnBoundaries);
      const columnGroups = groupItemsByColumn(glyphs, numColumns);

      // Process each column separately, left to right
      for (const columnItems of columnGroups) {
        if (columnItems.length === 0) continue;

        const lines = groupIntoHorizontalLines(columnItems);
        const internalParagraphs = groupIntoParagraphsHorizontal(lines);

        for (const para of internalParagraphs) {
          const { text, items } = buildParagraphText(para);
          if (!text) continue;

          const hash = hashString(text);
          const pid = `${docId}:p${pageIndex + 1}:${hash}`;
          paragraphs.push({
            pid,
            page: pageIndex + 1,
            source: text,
            status: "idle",
            rects: buildParagraphRects(pageIndex + 1, items),
          });
        }
      }

      return { paragraphs, watermarks };
    }
  }

  // Single column or vertical layout
  const lines = mode === "vertical" ? groupIntoVerticalColumns(glyphs) : groupIntoHorizontalLines(glyphs);
  const internalParagraphs = mode === "vertical" ? groupIntoParagraphsVertical(lines) : groupIntoParagraphsHorizontal(lines);

  for (const para of internalParagraphs) {
    const { text, items } = buildParagraphText(para);
    if (!text) continue;

    const hash = hashString(text);
    const pid = `${docId}:p${pageIndex + 1}:${hash}`;
    paragraphs.push({
      pid,
      page: pageIndex + 1,
      source: text,
      status: "idle",
      rects: buildParagraphRects(pageIndex + 1, items),
    });
  }

  return { paragraphs, watermarks };
}
