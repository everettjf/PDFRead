import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import ePub from "epubjs";
import type { Book, NavItem, Rendition } from "epubjs";
import * as ScrollArea from "@radix-ui/react-scroll-area";

type EpubParagraph = {
  pid: string;
  source: string;
  translation?: string;
  status: "idle" | "loading" | "done" | "error";
  href?: string; // Store the spine item href for navigation
  sectionTitle?: string; // Chapter/section title for display
};

type EpubViewerProps = {
  fileData: Uint8Array;
  onMetadata: (metadata: { title: string; author?: string; coverImage?: string }) => void;
  onParagraphsExtracted: (paragraphs: EpubParagraph[]) => void;
  onCurrentPageChange: (page: number, total: number) => void;
  onLoadingProgress?: (progress: number | null) => void;
  scale: number;
};

export type EpubViewerHandle = {
  navigateTo: (pid: string) => void;
};

export const EpubViewer = forwardRef<EpubViewerHandle, EpubViewerProps>(function EpubViewer({
  fileData,
  onMetadata,
  onParagraphsExtracted,
  onCurrentPageChange,
  onLoadingProgress,
  scale,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<NavItem[]>([]);
  const paragraphMapRef = useRef<Map<string, string>>(new Map()); // pid -> href
  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentChapter, setCurrentChapter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Store callbacks in refs to avoid dependency issues
  const onMetadataRef = useRef(onMetadata);
  const onParagraphsExtractedRef = useRef(onParagraphsExtracted);
  const onCurrentPageChangeRef = useRef(onCurrentPageChange);
  const onLoadingProgressRef = useRef(onLoadingProgress);

  useEffect(() => {
    onMetadataRef.current = onMetadata;
  }, [onMetadata]);

  useEffect(() => {
    onParagraphsExtractedRef.current = onParagraphsExtracted;
  }, [onParagraphsExtracted]);

  useEffect(() => {
    onCurrentPageChangeRef.current = onCurrentPageChange;
  }, [onCurrentPageChange]);

  useEffect(() => {
    onLoadingProgressRef.current = onLoadingProgress;
  }, [onLoadingProgress]);

  // Expose navigation method via ref
  useImperativeHandle(ref, () => ({
    navigateTo: (pid: string) => {
      const href = paragraphMapRef.current.get(pid);
      if (href && renditionRef.current) {
        renditionRef.current.display(href);
      }
    },
  }), []);

  // Load book only when fileData changes
  useEffect(() => {
    if (!containerRef.current || !fileData) return;

    const loadBook = async () => {
      try {
        setLoading(true);
        onLoadingProgressRef.current?.(5);

        // Clean up previous book
        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
          renditionRef.current = null;
        }

        // Clear container and paragraph map
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }
        paragraphMapRef.current.clear();

        // Create book from array buffer
        const book = ePub(fileData.buffer);
        bookRef.current = book;
        onLoadingProgressRef.current?.(15);

        // Wait for book to be ready
        await book.ready;
        onLoadingProgressRef.current?.(25);

        // Get metadata
        const metadata = await book.loaded.metadata;
        const cover = await book.coverUrl();

        onMetadataRef.current({
          title: metadata.title || "Untitled",
          author: metadata.creator,
          coverImage: cover || undefined,
        });
        onLoadingProgressRef.current?.(35);

        // Get table of contents
        const navigation = await book.loaded.navigation;
        tocRef.current = navigation.toc;
        setToc(navigation.toc);

        // Create rendition
        const rendition = book.renderTo(containerRef.current!, {
          width: "100%",
          height: "100%",
          spread: "none",
          flow: "scrolled-doc",
        });

        renditionRef.current = rendition;

        // Apply initial scale
        rendition.themes.fontSize(`${100 * scale}%`);

        // Track location changes
        rendition.on("relocated", (location: any) => {
          if (location.start) {
            const currentPage = location.start.displayed?.page || 1;
            const totalPages = location.start.displayed?.total || 1;
            onCurrentPageChangeRef.current(currentPage, totalPages);

            // Find current chapter using ref for latest value
            const href = location.start.href;
            const currentToc = tocRef.current;
            const chapter = currentToc.find((item) => {
              // Handle both full href and partial matches
              const itemHref = item.href.split("#")[0];
              return href.includes(itemHref) || itemHref.includes(href);
            });
            if (chapter) {
              setCurrentChapter(chapter.label);
            }
          }
        });

        onLoadingProgressRef.current?.(45);

        // Display first section
        await rendition.display();
        onLoadingProgressRef.current?.(55);

        // Extract text for translation (this will report progress 55-100%)
        await extractParagraphs(book);

        setLoading(false);
        onLoadingProgressRef.current?.(null);
      } catch (error) {
        console.error("Failed to load EPUB:", error);
        setLoading(false);
        onLoadingProgressRef.current?.(null);
      }
    };

    loadBook();

    return () => {
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
        renditionRef.current = null;
      }
    };
  }, [fileData]); // Only depend on fileData

  // Handle scale changes separately without reloading the book
  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${100 * scale}%`);
    }
  }, [scale]);

  const extractParagraphs = async (book: Book) => {
    const paragraphs: EpubParagraph[] = [];
    let pidCounter = 0;

    // Helper to find section title from TOC
    const findSectionTitle = (href: string): string | undefined => {
      const toc = tocRef.current;
      for (const item of toc) {
        const itemHref = item.href.split("#")[0];
        if (href.includes(itemHref) || itemHref.includes(href)) {
          return item.label;
        }
      }
      return undefined;
    };

    try {
      const spine = book.spine as any;
      if (!spine || !spine.items) {
        console.warn("EPUB spine is empty or undefined");
        onParagraphsExtractedRef.current(paragraphs);
        return;
      }

      const totalItems = spine.items.length;
      let processedItems = 0;

      for (const item of spine.items) {
        try {
          const doc = await book.load(item.href);
          const sectionTitle = findSectionTitle(item.href);
          // Handle both Document and string responses
          let textContent: string[] = [];

          if (doc instanceof Document) {
            const textNodes = doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, div, span");
            textNodes.forEach((node) => {
              const text = node.textContent?.trim();
              if (text && text.length > 10) {
                textContent.push(text);
              }
            });
          } else if (typeof doc === "string") {
            // Parse HTML string
            const parser = new DOMParser();
            const parsed = parser.parseFromString(doc, "text/html");
            const textNodes = parsed.querySelectorAll("p, h1, h2, h3, h4, h5, h6, div, span");
            textNodes.forEach((node) => {
              const text = node.textContent?.trim();
              if (text && text.length > 10) {
                textContent.push(text);
              }
            });
          }

          // Deduplicate and add to paragraphs
          const seen = new Set<string>();
          for (const text of textContent) {
            if (!seen.has(text)) {
              seen.add(text);
              const pid = `epub:${pidCounter++}`;
              paragraphs.push({
                pid,
                source: text,
                status: "idle",
                href: item.href,
                sectionTitle,
              });
              // Store mapping for navigation
              paragraphMapRef.current.set(pid, item.href);
            }
          }
        } catch (itemError) {
          console.warn(`Failed to load spine item ${item.href}:`, itemError);
        }

        processedItems++;
        // Report progress from 55% to 100%
        const progress = 55 + Math.round((processedItems / totalItems) * 45);
        onLoadingProgressRef.current?.(progress);
      }
    } catch (error) {
      console.error("Failed to extract paragraphs:", error);
    }

    console.log(`Extracted ${paragraphs.length} paragraphs from EPUB`);
    onParagraphsExtractedRef.current(paragraphs);
  };

  const handlePrev = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const handleNext = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const handleTocClick = useCallback((href: string) => {
    if (renditionRef.current) {
      renditionRef.current.display(href);
    }
  }, []);

  return (
    <div className="epub-viewer">
      <div className="epub-sidebar">
        <div className="epub-sidebar-title">Contents</div>
        <ScrollArea.Root className="epub-toc-scroll">
          <ScrollArea.Viewport>
            <div className="epub-toc">
              {toc.map((item, index) => (
                <button
                  key={item.href || index}
                  className={`epub-toc-item ${currentChapter === item.label ? "is-active" : ""}`}
                  onClick={() => handleTocClick(item.href)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
            <ScrollArea.Thumb className="scrollbar-thumb" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
      <div className="epub-content">
        {loading && <div className="epub-loading">Loading EPUB...</div>}
        <div ref={containerRef} className="epub-container" />
        <div className="epub-nav">
          <button className="btn btn-ghost" onClick={handlePrev}>
            Previous
          </button>
          <span className="epub-chapter">{currentChapter}</span>
          <button className="btn btn-ghost" onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
});
