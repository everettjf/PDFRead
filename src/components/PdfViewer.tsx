import { useMemo, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageDoc } from "../types";
import { PdfPage } from "./PdfPage";

type PdfViewerProps = {
  pdfDoc: PDFDocumentProxy;
  pages: PageDoc[];
  pageSizes: { width: number; height: number }[];
  scale: number;
  highlightSid?: string | null;
  onCurrentPageChange: (page: number) => void;
};

export function PdfViewer({
  pdfDoc,
  pages,
  pageSizes,
  scale,
  highlightSid,
  onCurrentPageChange,
}: PdfViewerProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const heights = useMemo(
    () => pageSizes.map((size) => size.height * scale + 32),
    [pageSizes, scale]
  );

  const cumulative = useMemo(() => {
    const offsets: number[] = [];
    let total = 0;
    for (const height of heights) {
      offsets.push(total);
      total += height;
    }
    return offsets;
  }, [heights]);

  function handleScroll() {
    const container = scrollerRef.current;
    if (!container) return;
    const center = container.scrollTop + container.clientHeight / 2;

    let low = 0;
    let high = cumulative.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = cumulative[mid];
      const end = start + heights[mid];
      if (center < start) {
        high = mid - 1;
      } else if (center > end) {
        low = mid + 1;
      } else {
        onCurrentPageChange(mid + 1);
        return;
      }
    }
  }

  return (
    <div className="pdf-viewer">
      <Virtuoso
        style={{ height: "100%" }}
        totalCount={pages.length}
        scrollerRef={(element) => {
          scrollerRef.current = element as HTMLDivElement | null;
        }}
        itemContent={(index) => {
          const pageNumber = index + 1;
          const pageDoc = pages[index];
          const size = pageSizes[index];
          return (
            <div className="pdf-page-wrapper" style={{ padding: "16px 0" }}>
              <PdfPage
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                scale={scale}
                baseWidth={size.width}
                baseHeight={size.height}
                sentences={pageDoc?.sentences ?? []}
                highlightSid={highlightSid}
              />
            </div>
          );
        }}
        onScroll={handleScroll}
      />
    </div>
  );
}
