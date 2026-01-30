import type { RecentBook } from "../../types";

type BookCardProps = {
  book: RecentBook;
  onOpen: (book: RecentBook) => void;
  onRemove: (book: RecentBook) => void;
};

function FileIcon({ type }: { type: string }) {
  if (type === 'epub') {
    return (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    );
  }
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function BookCard({ book, onOpen, onRemove }: BookCardProps) {
  const progressPercent = Math.round(book.progress);

  return (
    <div className="book-card" onClick={() => onOpen(book)}>
      <button
        className="book-card-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(book);
        }}
        title="Remove from library"
      >
        <RemoveIcon />
      </button>
      <div className="book-card-cover">
        {book.coverImage ? (
          <img src={book.coverImage} alt={book.title} />
        ) : (
          <div className="book-card-placeholder">
            <FileIcon type={book.fileType} />
          </div>
        )}
      </div>
      <div className="book-card-info">
        <div className="book-card-title" title={book.title}>
          {book.title}
        </div>
        {book.author && (
          <div className="book-card-author" title={book.author}>
            {book.author}
          </div>
        )}
        <div className="book-card-meta">
          <span className="book-card-type">{book.fileType.toUpperCase()}</span>
          <span className="book-card-progress">{progressPercent}%</span>
        </div>
        <div className="book-card-progress-bar">
          <div
            className="book-card-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
