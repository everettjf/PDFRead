import { useMemo, useCallback } from "react";
import { Virtuoso } from "react-virtuoso";
import { createEditor } from "slate";
import { Slate, Editable, withReact } from "slate-react";
import * as Popover from "@radix-ui/react-popover";
import type { PageDoc, Sentence, WordTranslation } from "../types";

type TranslationPaneProps = {
  pages: PageDoc[];
  activeSid?: string | null;
  hoverSid?: string | null;
  onHoverSid: (sid: string | null) => void;
  onActiveSid: (sid: string | null) => void;
  onTranslateSid: (sid: string) => void;
  onTranslateWord: (word: string, position: { x: number; y: number }) => void;
  wordTranslation: WordTranslation | null;
  onClearWordTranslation: () => void;
  onSelectPage: (page: number) => void;
};

type SentenceElement = {
  type: "sentence";
  sid: string;
  source: string;
  translation?: string;
  status: Sentence["status"];
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

function PageTranslation({
  page,
  activeSid,
  hoverSid,
  onHoverSid,
  onActiveSid,
  onTranslateSid,
  onTranslateWord,
  wordTranslation,
  onClearWordTranslation,
  onSelectPage,
}: {
  page: PageDoc;
  activeSid?: string | null;
  hoverSid?: string | null;
  onHoverSid: (sid: string | null) => void;
  onActiveSid: (sid: string | null) => void;
  onTranslateSid: (sid: string) => void;
  onTranslateWord: (word: string, position: { x: number; y: number }) => void;
  wordTranslation: WordTranslation | null;
  onClearWordTranslation: () => void;
  onSelectPage: (page: number) => void;
}) {
  const editor = useMemo(() => withReact(createEditor()), []);
  const value = useMemo(
    () =>
      page.sentences.map<SentenceElement>((sentence) => ({
        type: "sentence",
        sid: sentence.sid,
        source: sentence.source,
        translation: sentence.translation,
        status: sentence.status,
        children: [{ text: "" }],
      })),
    [page.sentences]
  );
  const slateKey = useMemo(
    () =>
      `${page.page}:${page.sentences
        .map((sentence) => `${sentence.sid}:${sentence.status}:${sentence.translation ?? ""}`)
        .join("|")}`,
    [page.page, page.sentences]
  );

  const handleWordClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't trigger word translation if user is selecting text
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        return;
      }

      // Get the word at click position
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;

      // Expand to word boundaries
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
        onTranslateWord(word, { x: e.clientX, y: e.clientY });
      }
    },
    [onTranslateWord]
  );

  return (
    <div className="translation-page">
      <div className="translation-page-title">Page {page.page}</div>
      <Slate key={slateKey} editor={editor} initialValue={value}>
        <Editable
          readOnly
          renderElement={({ attributes, element, children }) => {
            const sentence = element as SentenceElement;
            const isActive = sentence.sid === activeSid || sentence.sid === hoverSid;
            const translationText =
              sentence.status === "loading"
                ? "Translating..."
                : sentence.status === "error"
                ? "Translation failed."
                : sentence.translation || "";
            return (
              <div
                {...attributes}
                className={`sentence-block ${isActive ? "is-active" : ""}`}
                onMouseEnter={() => onHoverSid(sentence.sid)}
                onMouseLeave={() => onHoverSid(null)}
                onClick={() => {
                  onActiveSid(sentence.sid === activeSid ? null : sentence.sid);
                  onSelectPage(page.page);
                }}
              >
                <button
                  className="translate-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTranslateSid(sentence.sid);
                  }}
                  title="Translate sentence"
                >
                  <TranslateIcon />
                </button>
                <div className="sentence-source" onClick={handleWordClick}>
                  {sentence.source}
                </div>
                {translationText && (
                  <div className="sentence-translation">{translationText}</div>
                )}
                {children}
              </div>
            );
          }}
        />
      </Slate>
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
              <div className="word-popover-word">{wordTranslation.word}</div>
              <div className="word-popover-translation">
                {wordTranslation.translation || "Translating..."}
              </div>
              <Popover.Arrow className="word-popover-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}

export function TranslationPane({
  pages,
  activeSid,
  hoverSid,
  onHoverSid,
  onActiveSid,
  onTranslateSid,
  onTranslateWord,
  wordTranslation,
  onClearWordTranslation,
  onSelectPage,
}: TranslationPaneProps) {
  return (
    <div className="translation-pane">
      <Virtuoso
        style={{ height: "100%" }}
        totalCount={pages.length}
        itemContent={(index) => (
          <PageTranslation
            page={pages[index]}
            activeSid={activeSid}
            hoverSid={hoverSid}
            onHoverSid={onHoverSid}
            onActiveSid={onActiveSid}
            onTranslateSid={onTranslateSid}
            onTranslateWord={onTranslateWord}
            wordTranslation={wordTranslation}
            onClearWordTranslation={onClearWordTranslation}
            onSelectPage={onSelectPage}
          />
        )}
      />
    </div>
  );
}
