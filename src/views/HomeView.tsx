import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Separator from "@radix-ui/react-separator";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BookCard } from "../components/home/BookCard";
import type { RecentBook } from "../types";

type HomeViewProps = {
  onOpenBook: (book: RecentBook) => void;
  onOpenFile: () => void;
};

function AppLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 3.5h8.5L19.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"
        fill="currentColor"
        opacity="0.15"
      />
      <path
        d="M6 3.5h8.5L19.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M14.5 3.5V8H19" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 12h8M8 15.5h6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

export function HomeView({ onOpenBook, onOpenFile }: HomeViewProps) {
  const [books, setBooks] = useState<RecentBook[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBooks = useCallback(async () => {
    try {
      const result = await invoke<RecentBook[]>("get_recent_books");
      const mapped = result.map((book: any) => ({
        id: book.id,
        filePath: book.file_path,
        fileName: book.file_name,
        fileType: book.file_type,
        title: book.title,
        author: book.author,
        coverImage: book.cover_image,
        totalPages: book.total_pages,
        lastPage: book.last_page,
        progress: book.progress,
        lastOpenedAt: book.last_opened_at,
      }));
      setBooks(mapped);
    } catch (error) {
      console.error("Failed to load recent books:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const handleRemove = useCallback(async (book: RecentBook) => {
    try {
      await invoke("remove_recent_book", { id: book.id });
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
    } catch (error) {
      console.error("Failed to remove book:", error);
    }
  }, []);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="home-view">
        <header className="home-header">
          <div className="home-brand">
            <span className="home-brand-icon">
              <AppLogo />
            </span>
            <span className="home-brand-name">PDFRead</span>
          </div>

          <div className="home-actions">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="btn btn-primary home-open-btn">
                  <PlusIcon />
                  <span>Open</span>
                  <ChevronDownIcon />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="end">
                  <DropdownMenu.Item className="dropdown-item" onSelect={onOpenFile}>
                    <FileIcon />
                    <span>Open File...</span>
                    <span className="dropdown-shortcut">⌘O</span>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        <main className="home-content">
          {loading ? (
            <div className="home-loading">
              <div className="home-loading-spinner" />
            </div>
          ) : books.length === 0 ? (
            <div className="home-empty">
              <div className="home-empty-icon">
                <EmptyIcon />
              </div>
              <h2>No documents yet</h2>
              <p>Open a PDF or EPUB file to start reading</p>
              <button className="btn btn-primary btn-lg" onClick={onOpenFile}>
                <PlusIcon />
                <span>Open File</span>
              </button>
            </div>
          ) : (
            <div className="home-list-container">
              <div className="home-section-header">
                <span className="home-section-title">Recent</span>
                <Separator.Root className="home-section-sep" />
                <span className="home-section-count">{books.length}</span>
              </div>
              <ScrollArea.Root className="home-scroll">
                <ScrollArea.Viewport className="home-list-viewport">
                  <div className="home-list">
                    {books.map((book) => (
                      <BookCard
                        key={book.id}
                        book={book}
                        onOpen={onOpenBook}
                        onRemove={handleRemove}
                      />
                    ))}
                  </div>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
                  <ScrollArea.Thumb className="scrollbar-thumb" />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
            </div>
          )}
        </main>
      </div>
    </Tooltip.Provider>
  );
}
