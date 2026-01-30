import { useEffect, useRef, useState, useCallback } from "react";
import ePub from "epubjs";
import type { Book, NavItem, Rendition } from "epubjs";
import * as ScrollArea from "@radix-ui/react-scroll-area";

type EpubParagraph = {
  pid: string;
  source: string;
  translation?: string;
  status: "idle" | "loading" | "done" | "error";
};

type EpubViewerProps = {
  fileData: Uint8Array;
  onMetadata: (metadata: { title: string; author?: string; coverImage?: string }) => void;
  onParagraphsExtracted: (paragraphs: EpubParagraph[]) => void;
  onCurrentPageChange: (page: number, total: number) => void;
  scale: number;
};

export function EpubViewer({
  fileData,
  onMetadata,
  onParagraphsExtracted,
  onCurrentPageChange,
  scale,
}: EpubViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentChapter, setCurrentChapter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current || !fileData) return;

    const loadBook = async () => {
      try {
        setLoading(true);

        // Create book from array buffer
        const book = ePub(fileData.buffer);
        bookRef.current = book;

        // Wait for book to be ready
        await book.ready;

        // Get metadata
        const metadata = await book.loaded.metadata;
        const cover = await book.coverUrl();

        onMetadata({
          title: metadata.title || "Untitled",
          author: metadata.creator,
          coverImage: cover || undefined,
        });

        // Get table of contents
        const navigation = await book.loaded.navigation;
        setToc(navigation.toc);

        // Create rendition
        const rendition = book.renderTo(containerRef.current!, {
          width: "100%",
          height: "100%",
          spread: "none",
          flow: "scrolled-doc",
        });

        renditionRef.current = rendition;

        // Apply scale/font size
        rendition.themes.fontSize(`${100 * scale}%`);

        // Display first section
        await rendition.display();

        // Extract text for translation
        extractParagraphs(book);

        // Track location changes
        rendition.on("relocated", (location: any) => {
          if (location.start) {
            const currentPage = location.start.displayed?.page || 1;
            const totalPages = location.start.displayed?.total || 1;
            onCurrentPageChange(currentPage, totalPages);

            // Find current chapter
            const href = location.start.href;
            const chapter = toc.find((item) => item.href.includes(href));
            if (chapter) {
              setCurrentChapter(chapter.label);
            }
          }
        });

        setLoading(false);
      } catch (error) {
        console.error("Failed to load EPUB:", error);
        setLoading(false);
      }
    };

    loadBook();

    return () => {
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
    };
  }, [fileData, onMetadata, onCurrentPageChange, scale]);

  const extractParagraphs = async (book: Book) => {
    const paragraphs: EpubParagraph[] = [];
    let pidCounter = 0;

    try {
      const spine = book.spine as any;
      for (const item of spine.items) {
        const doc = await book.load(item.href);
        if (doc instanceof Document) {
          const textNodes = doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6");
          textNodes.forEach((node) => {
            const text = node.textContent?.trim();
            if (text && text.length > 10) {
              paragraphs.push({
                pid: `epub:${pidCounter++}`,
                source: text,
                status: "idle",
              });
            }
          });
        }
      }
    } catch (error) {
      console.error("Failed to extract paragraphs:", error);
    }

    onParagraphsExtracted(paragraphs);
  };

  const handlePrev = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const handleNext = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const handleTocClick = useCallback((href: string) => {
    renditionRef.current?.display(href);
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
                  key={index}
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
}
