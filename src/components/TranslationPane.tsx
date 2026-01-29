import { useMemo, useCallback } from "react";
import { Virtuoso } from "react-virtuoso";
import { createEditor } from "slate";
import { Slate, Editable, withReact } from "slate-react";
import * as Popover from "@radix-ui/react-popover";
import type { PageDoc, Paragraph, WordTranslation } from "../types";

type TranslationPaneProps = {
  pages: PageDoc[];
  activePid?: string | null;
  hoverPid?: string | null;
  onHoverPid: (pid: string | null) => void;
  onTranslatePid: (pid: string) => void;
  onLocatePid: (pid: string, page: number) => void;
  onTranslateText: (text: string, position: { x: number; y: number }) => void;
  wordTranslation: WordTranslation | null;
  onClearWordTranslation: () => void;
  onToggleLikeWord: (word: WordTranslation) => void;
};

type ParagraphElement = {
  type: "paragraph";
  pid: string;
  source: string;
  translation?: string;
  status: Paragraph["status"];
  children: { text: string }[];
};

function TranslateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

function LocateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function PageTranslation({
  page,
  activePid,
  hoverPid,
  onHoverPid,
  onTranslatePid,
  onLocatePid,
  onTranslateText,
}: {
  page: PageDoc;
  activePid?: string | null;
  hoverPid?: string | null;
  onHoverPid: (pid: string | null) => void;
  onTranslatePid: (pid: string) => void;
  onLocatePid: (pid: string, page: number) => void;
  onTranslateText: (text: string, position: { x: number; y: number }) => void;
}) {
  const editor = useMemo(() => withReact(createEditor()), []);
  const value = useMemo(
    () =>
      page.paragraphs.map<ParagraphElement>((para) => ({
        type: "paragraph",
        pid: para.pid,
        source: para.source,
        translation: para.translation,
        status: para.status,
        children: [{ text: "" }],
      })),
    [page.paragraphs]
  );
  const slateKey = useMemo(
    () =>
      `${page.page}:${page.paragraphs
        .map((para) => `${para.pid}:${para.status}:${para.translation ?? ""}`)
        .join("|")}`,
    [page.page, page.paragraphs]
  );

  const handleTextInteraction = useCallback(
    (e: React.MouseEvent) => {
      // Check if there's a text selection
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        // User has selected text - don't do anything on click
        // The selection will be handled by mouseup
        return;
      }

      // Single word click - get the word at click position
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;

      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return;

      const text = node.textContent || "";
      let start = range.startOffset;
      let end = range.startOffset;

      // Find word boundaries
      while (start > 0 && /[a-zA-Z]/.test(text[start - 1])) {
        start--;
      }
      while (end < text.length && /[a-zA-Z]/.test(text[end])) {
        end++;
      }

      const word = text.slice(start, end).trim();

      if (word && /^[a-zA-Z]+$/.test(word) && word.length > 1) {
        e.stopPropagation();
        onTranslateText(word, { x: e.clientX, y: e.clientY });
      }
    },
    [onTranslateText]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Check if there's a text selection
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0 && selectedText.length < 200) {
        // User has selected text - show translation
        e.stopPropagation();
        onTranslateText(selectedText, { x: e.clientX, y: e.clientY });
      }
    },
    [onTranslateText]
  );

  return (
    <div className="translation-page">
      <div className="translation-page-title">Page {page.page}</div>
      <Slate key={slateKey} editor={editor} initialValue={value}>
        <Editable
          readOnly
          renderElement={({ attributes, element, children }) => {
            const para = element as ParagraphElement;
            const isActive = para.pid === activePid || para.pid === hoverPid;
            const translationText =
              para.status === "loading"
                ? "Translating..."
                : para.status === "error"
                ? "Translation failed."
                : para.translation || "";
            return (
              <div
                {...attributes}
                className={`paragraph-block ${isActive ? "is-active" : ""}`}
                onMouseEnter={() => onHoverPid(para.pid)}
                onMouseLeave={() => onHoverPid(null)}
              >
                <div className="paragraph-actions">
                  <button
                    className="action-btn locate-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLocatePid(para.pid, page.page);
                    }}
                    title="Locate in PDF"
                  >
                    <LocateIcon />
                  </button>
                  <button
                    className="action-btn translate-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTranslatePid(para.pid);
                    }}
                    title="Translate paragraph"
                  >
                    <TranslateIcon />
                  </button>
                </div>
                <div
                  className="paragraph-source"
                  onClick={handleTextInteraction}
                  onMouseUp={handleMouseUp}
                >
                  {para.source}
                </div>
                {translationText && (
                  <div className="paragraph-translation">{translationText}</div>
                )}
                {children}
              </div>
            );
          }}
        />
      </Slate>
    </div>
  );
}

export function TranslationPane({
  pages,
  activePid,
  hoverPid,
  onHoverPid,
  onTranslatePid,
  onLocatePid,
  onTranslateText,
  wordTranslation,
  onClearWordTranslation,
  onToggleLikeWord,
}: TranslationPaneProps) {
  return (
    <div className="translation-pane">
      <Virtuoso
        style={{ height: "100%" }}
        totalCount={pages.length}
        itemContent={(index) => (
          <PageTranslation
            page={pages[index]}
            activePid={activePid}
            hoverPid={hoverPid}
            onHoverPid={onHoverPid}
            onTranslatePid={onTranslatePid}
            onLocatePid={onLocatePid}
            onTranslateText={onTranslateText}
          />
        )}
      />
      {wordTranslation && (
        <Popover.Root open={true} onOpenChange={(open) => !open && onClearWordTranslation()}>
          <Popover.Anchor
            style={{
              position: "fixed",
              left: wordTranslation.position.x,
              top: wordTranslation.position.y,
            }}
          />
          <Popover.Portal>
            <Popover.Content
              className="word-popover"
              sideOffset={8}
              onPointerDownOutside={() => onClearWordTranslation()}
              onEscapeKeyDown={() => onClearWordTranslation()}
            >
              <div className="word-popover-header">
                <div className="word-popover-word">{wordTranslation.word}</div>
                <button
                  className={`word-like-btn ${wordTranslation.isLiked ? "is-liked" : ""}`}
                  onClick={() => onToggleLikeWord(wordTranslation)}
                  title={wordTranslation.isLiked ? "Remove from vocabulary" : "Add to vocabulary"}
                >
                  <HeartIcon filled={wordTranslation.isLiked} />
                </button>
              </div>
              {wordTranslation.phonetic && (
                <div className="word-popover-phonetic">
                  <span className="phonetic-label">UK</span>
                  <span className="phonetic-text">{wordTranslation.phonetic}</span>
                </div>
              )}
              {wordTranslation.isLoading ? (
                <div className="word-popover-loading">Looking up...</div>
              ) : (
                <div className="word-popover-definitions">
                  {wordTranslation.definitions.map((def, index) => (
                    <div key={index} className="word-definition">
                      {def.pos && <span className="word-pos">{def.pos}</span>}
                      <span className="word-meanings">{def.meanings}</span>
                    </div>
                  ))}
                </div>
              )}
              <Popover.Arrow className="word-popover-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
