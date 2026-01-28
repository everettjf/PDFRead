import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { createEditor } from "slate";
import { Slate, Editable, withReact } from "slate-react";
import type { PageDoc, Sentence } from "../types";

type TranslationPaneProps = {
  pages: PageDoc[];
  activeSid?: string | null;
  hoverSid?: string | null;
  onHoverSid: (sid: string | null) => void;
  onActiveSid: (sid: string | null) => void;
};

type SentenceElement = {
  type: "sentence";
  sid: string;
  source: string;
  translation?: string;
  status: Sentence["status"];
  children: { text: string }[];
};

function PageTranslation({
  page,
  activeSid,
  hoverSid,
  onHoverSid,
  onActiveSid,
}: {
  page: PageDoc;
  activeSid?: string | null;
  hoverSid?: string | null;
  onHoverSid: (sid: string | null) => void;
  onActiveSid: (sid: string | null) => void;
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
                onClick={() => onActiveSid(sentence.sid === activeSid ? null : sentence.sid)}
              >
                <div className="sentence-source">{sentence.source}</div>
                <div className="sentence-translation">{translationText}</div>
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
  activeSid,
  hoverSid,
  onHoverSid,
  onActiveSid,
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
          />
        )}
      />
    </div>
  );
}
