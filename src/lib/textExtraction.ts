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
};

type Line = {
  id: number;
  y: number;
  items: GlyphItem[];
};

type Paragraph = {
  items: GlyphItem[];
};

function normalizeTextItems(page: PDFPageProxy, scale: number): Promise<GlyphItem[]> {
  return page.getTextContent().then((content) => {
    const viewport = page.getViewport({ scale });
    const items: GlyphItem[] = [];

    for (const item of content.items as any[]) {
      const text = String(item.str ?? "").trim();
      if (!text) continue;

      const transform = (window as any).pdfjsLib.Util.transform(viewport.transform, item.transform);
      const x = transform[4];
      const y = transform[5];
      const fontHeight = Math.hypot(transform[2], transform[3]);
      const w = item.width * viewport.scale;
      const h = fontHeight;
      const top = y - h;

      items.push({ text, x, y: top, w, h, lineId: -1 });
    }

    return items;
  });
}

function groupIntoLines(items: GlyphItem[]): Line[] {
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

function groupIntoParagraphs(lines: Line[]): Paragraph[] {
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

  const sentenceRegex = /[^.!?]+[.!?]+|[^.!?]+$/g;
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
  const glyphs = await normalizeTextItems(page, 1);
  const lines = groupIntoLines(glyphs);
  const paragraphs = groupIntoParagraphs(lines);

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
