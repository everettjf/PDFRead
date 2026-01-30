import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { BookCard } from "../components/home/BookCard";
import type { RecentBook } from "../types";

type HomeViewProps = {
  onOpenBook: (book: RecentBook) => void;
  onOpenFile: () => void;
};

function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function HomeView({ onOpenBook, onOpenFile }: HomeViewProps) {
  const [books, setBooks] = useState<RecentBook[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBooks = useCallback(async () => {
    try {
      const result = await invoke<RecentBook[]>("get_recent_books");
      // Convert snake_case to camelCase
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
    <div className="home-view">
      <header className="home-header">
        <div className="home-title">
          <span className="home-title-icon">
            <BookIcon />
          </span>
          <h1>Library</h1>
        </div>
        <button className="btn btn-primary" onClick={onOpenFile}>
          <PlusIcon />
          <span>Open File</span>
        </button>
      </header>

      <main className="home-content">
        {loading ? (
          <div className="home-loading">Loading library...</div>
        ) : books.length === 0 ? (
          <div className="home-empty">
            <div className="home-empty-icon">
              <BookIcon />
            </div>
            <h2>No books yet</h2>
            <p>Open a PDF or EPUB file to start reading</p>
            <button className="btn btn-primary" onClick={onOpenFile}>
              Open File
            </button>
          </div>
        ) : (
          <ScrollArea.Root className="home-scroll">
            <ScrollArea.Viewport className="home-grid-viewport">
              <div className="home-grid">
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
        )}
      </main>
    </div>
  );
}
