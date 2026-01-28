import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?worker";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import * as Dialog from "@radix-ui/react-dialog";
import * as Label from "@radix-ui/react-label";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Toolbar from "@radix-ui/react-toolbar";
import { PdfViewer } from "./components/PdfViewer";
import { TranslationPane } from "./components/TranslationPane";
import { extractPageSentences } from "./lib/textExtraction";
import { hashBuffer } from "./lib/hash";
import type { PageDoc, TranslationSettings } from "./types";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerPort = new pdfjsWorker();
(window as any).pdfjsLib = pdfjsLib;

const DEFAULT_SETTINGS: TranslationSettings = {
  targetLanguage: { label: "Chinese (Simplified)", code: "zh-CN" },
  model: "openai/gpt-4o-mini",
  temperature: 0.2,
  mode: "window",
  radius: 2,
  chunkSize: 10,
  theme: "system",
};

const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5, 2];
const LANGUAGE_PRESETS = [
  { label: "Chinese (Simplified)", code: "zh-CN" },
  { label: "Chinese (Traditional)", code: "zh-TW" },
  { label: "Japanese", code: "ja" },
  { label: "Korean", code: "ko" },
  { label: "Spanish", code: "es" },
  { label: "French", code: "fr" },
  { label: "German", code: "de" },
  { label: "Italian", code: "it" },
];

export default function App() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[]>([]);
  const [pages, setPages] = useState<PageDoc[]>([]);
  const [docId, setDocId] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [settings, setSettings] = useState<TranslationSettings>(DEFAULT_SETTINGS);
  const [hoverSid, setHoverSid] = useState<string | null>(null);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Open a PDF to get started.");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");

  const translationRequestId = useRef(0);
  const translatingRef = useRef(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const highlightSid = hoverSid ?? activeSid;

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const resolveTheme = () => {
      const systemTheme = mediaQuery.matches ? "dark" : "light";
      const resolved = settings.theme === "system" ? systemTheme : settings.theme;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };

    resolveTheme();

    if (settings.theme === "system") {
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", resolveTheme);
        return () => mediaQuery.removeEventListener("change", resolveTheme);
      }
      mediaQuery.addListener(resolveTheme);
      return () => mediaQuery.removeListener(resolveTheme);
    }

    return undefined;
  }, [settings.theme]);

  const handleOpenPdf = useCallback(async () => {
    const selection = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!selection || Array.isArray(selection)) return;

    setStatusMessage("Loading PDF...");
    setPdfDoc(null);
    setPages([]);
    setPageSizes([]);

    const rawBytes = (await invoke("read_pdf_file", { path: selection })) as number[];
    const bytes = new Uint8Array(rawBytes);
    const buffer = bytes.buffer.slice(0);
    const hash = await hashBuffer(buffer);
    const nextDocId = hash.slice(0, 12);

    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const doc = await loadingTask.promise;

    const sizes: { width: number; height: number }[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }

    const initialPages: PageDoc[] = sizes.map((_, index) => ({ page: index + 1, sentences: [] }));

    setPdfDoc(doc);
    setPageSizes(sizes);
    setPages(initialPages);
    setDocId(nextDocId);
    setCurrentPage(1);
    setStatusMessage("Extracting text...");

    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const sentences = await extractPageSentences(page, nextDocId, i - 1);
      setPages((prev) =>
        prev.map((entry) => (entry.page === i ? { ...entry, sentences } : entry))
      );
    }
    setStatusMessage("Ready.");
  }, []);

  const translateWindowPages = useMemo(() => {
    if (!pages.length) return [];
    if (settings.mode === "chunk") {
      const chunkIndex = Math.floor((currentPage - 1) / settings.chunkSize);
      const start = chunkIndex * settings.chunkSize + 1;
      const end = Math.min(pages.length, start + settings.chunkSize - 1);
      return pages.filter((page) => page.page >= start && page.page <= end);
    }
    const start = Math.max(1, currentPage - settings.radius);
    const end = Math.min(pages.length, currentPage + settings.radius);
    return pages.filter((page) => page.page >= start && page.page <= end);
  }, [currentPage, pages, settings.chunkSize, settings.mode, settings.radius]);

  useEffect(() => {
    if (!docId || translateWindowPages.length === 0) return;

    window.clearTimeout(debounceRef.current);
    const requestId = ++translationRequestId.current;

    debounceRef.current = window.setTimeout(async () => {
      if (translatingRef.current) return;

      const pending = translateWindowPages
        .flatMap((page) => page.sentences)
        .filter((sentence) => sentence.status === "idle");

      if (pending.length === 0) return;

      translatingRef.current = true;
      setPages((prev) =>
        prev.map((page) => ({
          ...page,
          sentences: page.sentences.map((sentence) =>
            pending.some((item) => item.sid === sentence.sid)
              ? { ...sentence, status: "loading" }
              : sentence
          ),
        }))
      );

      try {
        const payload = pending.map((sentence) => ({ sid: sentence.sid, text: sentence.source }));
        const results = (await invoke("openrouter_translate", {
          model: settings.model,
          temperature: settings.temperature,
          targetLanguage: settings.targetLanguage,
          sentences: payload,
        })) as { sid: string; translation: string }[];

        if (translationRequestId.current !== requestId) return;

        const translationMap = new Map(results.map((item) => [item.sid, item.translation]));
        setPages((prev) =>
          prev.map((page) => ({
            ...page,
            sentences: page.sentences.map((sentence) => {
              if (!pending.some((item) => item.sid === sentence.sid)) return sentence;
              const translation = translationMap.get(sentence.sid);
              if (!translation) {
                return { ...sentence, status: "error" };
              }
              return { ...sentence, translation, status: "done" };
            }),
          }))
        );
      } catch (error) {
        if (translationRequestId.current === requestId) {
          setPages((prev) =>
            prev.map((page) => ({
              ...page,
              sentences: page.sentences.map((sentence) =>
                pending.some((item) => item.sid === sentence.sid)
                  ? { ...sentence, status: "error" }
                  : sentence
              ),
            }))
          );
        }
        setStatusMessage(`Translation error: ${String(error)}`);
      } finally {
        translatingRef.current = false;
      }
    }, 400);

    return () => {
      window.clearTimeout(debounceRef.current);
    };
  }, [docId, settings, translateWindowPages]);

  const handleZoomChange = (nextScale: number) => {
    setScale(nextScale);
  };

  const currentScaleIndex = useMemo(() => {
    const index = ZOOM_LEVELS.findIndex((level) => level === scale);
    return index >= 0 ? index : ZOOM_LEVELS.indexOf(1);
  }, [scale]);

  const targetPreset = useMemo(
    () => LANGUAGE_PRESETS.find((item) => item.code === settings.targetLanguage.code),
    [settings.targetLanguage.code]
  );
  const languageTriggerLabel = targetPreset
    ? `${targetPreset.label} (${targetPreset.code})`
    : `Custom (${settings.targetLanguage.code || "code"})`;
  const filteredLanguages = useMemo(() => {
    const query = languageQuery.trim().toLowerCase();
    if (!query) return LANGUAGE_PRESETS;
    return LANGUAGE_PRESETS.filter(
      (item) =>
        item.label.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)
    );
  }, [languageQuery]);

  const handleScaleStep = (direction: "in" | "out") => {
    const nextIndex =
      direction === "in"
        ? Math.min(ZOOM_LEVELS.length - 1, currentScaleIndex + 1)
        : Math.max(0, currentScaleIndex - 1);
    handleZoomChange(ZOOM_LEVELS[nextIndex]);
  };

  const totalPages = pages.length;

  return (
    <div className="app-shell">
      <Toolbar.Root className="app-header" aria-label="Toolbar">
        <div className="header-left">
          <div className="app-title">PDF Bilingual Reader</div>
          <Toolbar.Button className="btn" onClick={handleOpenPdf}>
            Open PDF
          </Toolbar.Button>
          <div className="status-text">{statusMessage}</div>
        </div>
        <Toolbar.Separator className="toolbar-sep" />
        <div className="header-right">
          <div className="page-info">
            Page {currentPage} of {totalPages || "-"}
          </div>
          <div className="zoom-controls">
            <Toolbar.Button className="btn btn-ghost" onClick={() => handleScaleStep("out")}>
              -
            </Toolbar.Button>
            <Select.Root value={String(scale)} onValueChange={(value) => handleZoomChange(Number(value))}>
              <Select.Trigger className="select-trigger" aria-label="Zoom">
                <Select.Value />
              </Select.Trigger>
              <Select.Content className="select-content" position="popper">
                {ZOOM_LEVELS.map((level) => (
                  <Select.Item key={level} value={String(level)} className="select-item">
                    <Select.ItemText>{Math.round(level * 100)}%</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Toolbar.Button className="btn btn-ghost" onClick={() => handleScaleStep("in")}>
              +
            </Toolbar.Button>
          </div>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Toolbar.Button className="btn btn-primary">Settings</Toolbar.Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content">
                <Dialog.Title className="dialog-title">Settings</Dialog.Title>
                <div className="settings-grid">
                  <Label.Root className="settings-label" htmlFor="theme-select">
                    Theme
                  </Label.Root>
                  <Select.Root
                    value={settings.theme}
                    onValueChange={(value) =>
                      setSettings((prev) => ({
                        ...prev,
                        theme: value as TranslationSettings["theme"],
                      }))
                    }
                  >
                    <Select.Trigger className="select-trigger" id="theme-select">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content className="select-content" position="popper">
                      <Select.Item value="system" className="select-item">
                        <Select.ItemText>system</Select.ItemText>
                      </Select.Item>
                      <Select.Item value="light" className="select-item">
                        <Select.ItemText>light</Select.ItemText>
                      </Select.Item>
                      <Select.Item value="dark" className="select-item">
                        <Select.ItemText>dark</Select.ItemText>
                      </Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <Label.Root className="settings-label" htmlFor="target-language">
                    Target Language
                  </Label.Root>
                  <Popover.Root open={languageOpen} onOpenChange={setLanguageOpen}>
                    <Popover.Trigger asChild>
                      <button className="select-trigger" type="button" id="target-language">
                        {languageTriggerLabel}
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="popover-content" sideOffset={8}>
                        <div className="popover-title">Choose or search</div>
                        <input
                          className="input popover-input"
                          placeholder="Search language or code..."
                          value={languageQuery}
                          onChange={(event) => setLanguageQuery(event.target.value)}
                        />
                        <ScrollArea.Root className="popover-scroll">
                          <ScrollArea.Viewport className="popover-list">
                            {filteredLanguages.map((preset) => (
                              <button
                                key={preset.code}
                                className={`popover-item ${
                                  preset.code === settings.targetLanguage.code ? "is-selected" : ""
                                }`}
                                type="button"
                                onClick={() => {
                                  setSettings((prev) => ({
                                    ...prev,
                                    targetLanguage: { label: preset.label, code: preset.code },
                                  }));
                                  setLanguageOpen(false);
                                }}
                              >
                                <span>{preset.label}</span>
                                <span className="popover-code">{preset.code}</span>
                              </button>
                            ))}
                            {filteredLanguages.length === 0 ? (
                              <div className="popover-empty">
                                No matches. Edit below for custom.
                              </div>
                            ) : null}
                          </ScrollArea.Viewport>
                          <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
                            <ScrollArea.Thumb className="scrollbar-thumb" />
                          </ScrollArea.Scrollbar>
                        </ScrollArea.Root>
                        <div className="popover-hint">Custom values can be edited below.</div>
                        <Popover.Arrow className="popover-arrow" />
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  <Label.Root className="settings-label" htmlFor="target-label">
                    Target Language Label
                  </Label.Root>
                  <input
                    id="target-label"
                    className="input"
                    value={settings.targetLanguage.label}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        targetLanguage: {
                          ...prev.targetLanguage,
                          label: event.target.value,
                        },
                      }))
                    }
                  />
                  <Label.Root className="settings-label" htmlFor="target-code">
                    Target Language Code
                  </Label.Root>
                  <input
                    id="target-code"
                    className="input"
                    value={settings.targetLanguage.code}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        targetLanguage: {
                          ...prev.targetLanguage,
                          code: event.target.value,
                        },
                      }))
                    }
                  />
                  <Label.Root className="settings-label" htmlFor="model-input">
                    Model
                  </Label.Root>
                  <input
                    id="model-input"
                    className="input"
                    value={settings.model}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, model: event.target.value }))
                    }
                  />
                  <Label.Root className="settings-label" htmlFor="mode-select">
                    Mode
                  </Label.Root>
                  <Select.Root
                    value={settings.mode}
                    onValueChange={(value) =>
                      setSettings((prev) => ({
                        ...prev,
                        mode: value as TranslationSettings["mode"],
                      }))
                    }
                  >
                    <Select.Trigger className="select-trigger" id="mode-select">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content className="select-content" position="popper">
                      <Select.Item value="window" className="select-item">
                        <Select.ItemText>window</Select.ItemText>
                      </Select.Item>
                      <Select.Item value="chunk" className="select-item">
                        <Select.ItemText>chunk</Select.ItemText>
                      </Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <Label.Root className="settings-label" htmlFor="radius-input">
                    Radius (window mode)
                  </Label.Root>
                  <input
                    id="radius-input"
                    className="input"
                    type="number"
                    min={0}
                    value={settings.radius}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, radius: Number(event.target.value) }))
                    }
                  />
                  <Label.Root className="settings-label" htmlFor="chunk-input">
                    Chunk Size (chunk mode)
                  </Label.Root>
                  <input
                    id="chunk-input"
                    className="input"
                    type="number"
                    min={1}
                    value={settings.chunkSize}
                    onChange={(event) =>
                      setSettings((prev) => ({ ...prev, chunkSize: Number(event.target.value) }))
                    }
                  />
                </div>
                <Dialog.Close asChild>
                  <button className="btn btn-primary">Done</button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </Toolbar.Root>
      <main className="app-main">
        <section className="pane pane-left">
          {pdfDoc ? (
            <PdfViewer
              pdfDoc={pdfDoc}
              pages={pages}
              pageSizes={pageSizes}
              scale={scale}
              highlightSid={highlightSid}
              onCurrentPageChange={setCurrentPage}
            />
          ) : (
            <div className="empty-state">No PDF loaded.</div>
          )}
        </section>
        <section className="pane pane-right">
          <div className="pane-body">
            {pdfDoc ? (
              <TranslationPane
                pages={pages}
                activeSid={activeSid}
                hoverSid={hoverSid}
                onHoverSid={setHoverSid}
                onActiveSid={setActiveSid}
              />
            ) : (
              <div className="empty-state">Translations will appear here.</div>
            )}
          </div>
          <div className="side-footer">OpenRouter translation via Tauri backend.</div>
        </section>
      </main>
    </div>
  );
}
