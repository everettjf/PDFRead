import { useEffect, useRef } from "react";
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Sentence } from "../types";

const TEXT_LAYER_CLASS = "pdf-text-layer";

type PdfPageProps = {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  baseWidth: number;
  baseHeight: number;
  sentences: Sentence[];
  highlightSid?: string | null;
};

export function PdfPage({
  pdfDoc,
  pageNumber,
  scale,
  baseWidth,
  baseHeight,
  sentences,
  highlightSid,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
      }

      if (textLayerRef.current) {
        const container = textLayerRef.current;
        container.innerHTML = "";
        container.classList.add(TEXT_LAYER_CLASS);
        const textLayer = new TextLayerBuilder({ pdfPage: page });
        textLayer.div.classList.add("pdf-text-layer-inner");
        await textLayer.render(viewport);
        if (cancelled) return;
        container.appendChild(textLayer.div);
      }
    }

    renderPage();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, scale]);

  const highlightRects = highlightSid
    ? sentences.filter((sentence) => sentence.sid === highlightSid).flatMap((sentence) => sentence.rects)
    : [];

  return (
    <div
      className="pdf-page"
      style={{ width: baseWidth * scale, height: baseHeight * scale }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textLayerRef} className="pdf-text-layer" />
      <div className="pdf-overlay">
        {highlightRects.map((rect, index) => (
          <div
            key={`${rect.page}-${rect.x}-${rect.y}-${index}`}
            className="pdf-highlight"
            style={{
              left: rect.x * scale,
              top: rect.y * scale,
              width: rect.w * scale,
              height: rect.h * scale,
            }}
          />
        ))}
      </div>
    </div>
  );
}
