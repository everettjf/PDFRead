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
import type { PageDoc, TranslationSettings, WordTranslation } from "./types";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerPort = new pdfjsWorker();
(window as any).pdfjsLib = pdfjsLib;

const DEFAULT_SETTINGS: TranslationSettings = {
  targetLanguage: { label: "Chinese (Simplified)", code: "zh-CN" },
  model: "openai/gpt-4o-mini",
  temperature: 0,
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
  const [viewMode, setViewMode] = useState<"split" | "pdf" | "translation">("split");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [apiKeyStatus, setApiKeyStatus] = useState<string>("");
  const [apiKeySaving, setApiKeySaving] = useState<boolean>(false);
  const [apiKeyExists, setApiKeyExists] = useState<boolean>(false);
  const [apiKeyTesting, setApiKeyTesting] = useState<boolean>(false);
  const [scrollToPage, setScrollToPage] = useState<number | null>(null);
  const [wordTranslation, setWordTranslation] = useState<WordTranslation | null>(null);

  const pagesRef = useRef<PageDoc[]>([]);
  const wordTranslationCacheRef = useRef<Map<string, string>>(new Map());
  const settingsRef = useRef(settings);
  const docIdRef = useRef(docId);
  const translationRequestId = useRef(0);
  const translatingRef = useRef(false);
  const debounceRef = useRef<number | undefined>(undefined);
  const translateQueueRef = useRef<string[]>([]);

  const highlightSid = hoverSid ?? activeSid;

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

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

  useEffect(() => {
    if (!settingsOpen) return;
    setApiKeyStatus("");
    invoke<{ exists: boolean }>("get_openrouter_key_info")
      .then((info) => setApiKeyExists(info.exists))
      .catch(() => setApiKeyExists(false));
  }, [settingsOpen]);

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
    translationRequestId.current = 0;
    translatingRef.current = false;
    translateQueueRef.current = [];
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

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
    setStatusMessage("Ready. Click a sentence to translate.");
  }, []);
  const runTranslateQueue = useCallback(async () => {
    if (translatingRef.current) return;
    if (!docIdRef.current) return;

    const uniqueQueue = Array.from(new Set(translateQueueRef.current));
    translateQueueRef.current = [];
    if (uniqueQueue.length === 0) return;

    const pending = pagesRef.current
      .flatMap((page) => page.sentences)
      .filter(
        (sentence) =>
          uniqueQueue.includes(sentence.sid) &&
          (sentence.status === "idle" || sentence.status === "error")
      );

    if (pending.length === 0) return;

    translatingRef.current = true;
    const requestId = ++translationRequestId.current;

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
      const invokeWithTimeout = <T,>(promise: Promise<T>, timeoutMs: number) => {
        let timeoutId: number | undefined;
        const timeoutPromise = new Promise<T>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error("Translation timed out.")), timeoutMs);
        });
        return Promise.race([promise, timeoutPromise]).finally(() => {
          if (timeoutId) window.clearTimeout(timeoutId);
        });
      };
      const currentSettings = settingsRef.current;
      const results = (await invokeWithTimeout(
        invoke("openrouter_translate", {
          model: currentSettings.model,
          temperature: currentSettings.temperature,
          targetLanguage: currentSettings.targetLanguage,
          sentences: payload,
        }) as Promise<{ sid: string; translation: string }[]>,
        30000
      )) as { sid: string; translation: string }[];

      if (translationRequestId.current !== requestId) {
        setPages((prev) =>
          prev.map((page) => ({
            ...page,
            sentences: page.sentences.map((sentence) =>
              pending.some((item) => item.sid === sentence.sid) && sentence.status === "loading"
                ? { ...sentence, status: "idle" }
                : sentence
            ),
          }))
        );
        return;
      }

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
      const errorText = String(error);
      const friendlyMessage = errorText.includes("openrouter_key.txt")
        ? "OpenRouter API key is not configured."
        : `Translation error: ${errorText}`;
      setStatusMessage(friendlyMessage);
    } finally {
      translatingRef.current = false;
      if (translateQueueRef.current.length > 0) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
          void runTranslateQueue();
        }, 0);
      }
    }
  }, []);

  const handleTranslateSid = useCallback(
    (sid: string) => {
      if (!docIdRef.current) return;
      const sentence = pagesRef.current
        .flatMap((page) => page.sentences)
        .find((item) => item.sid === sid);
      if (!sentence) return;
      if (sentence.status === "done" || sentence.status === "loading") return;

      translateQueueRef.current = Array.from(new Set([...translateQueueRef.current, sid]));
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void runTranslateQueue();
      }, 400);
    },
    [runTranslateQueue]
  );

  const handleTranslateWord = useCallback(
    async (word: string, position: { x: number; y: number }) => {
      const normalizedWord = word.toLowerCase();

      // Check cache first
      const cached = wordTranslationCacheRef.current.get(normalizedWord);
      if (cached) {
        setWordTranslation({ word, translation: cached, position });
        return;
      }

      // Show loading state
      setWordTranslation({ word, translation: "", position });

      try {
        const currentSettings = settingsRef.current;
        const results = (await invoke("openrouter_translate", {
          model: currentSettings.model,
          temperature: currentSettings.temperature,
          targetLanguage: currentSettings.targetLanguage,
          sentences: [{ sid: "word", text: word }],
        })) as { sid: string; translation: string }[];

        const translation = results[0]?.translation || "Translation failed";

        // Cache the result
        wordTranslationCacheRef.current.set(normalizedWord, translation);

        setWordTranslation({ word, translation, position });
      } catch (error) {
        setWordTranslation({ word, translation: "Translation failed", position });
      }
    },
    []
  );

  const handleClearWordTranslation = useCallback(() => {
    setWordTranslation(null);
  }, []);

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
          <div className="app-title">
            <span className="app-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <path
                  d="M6 3.5h8.5L19.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"
                  fill="currentColor"
                  opacity="0.18"
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
            </span>
            PDF Read
          </div>
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
          <Select.Root value={viewMode} onValueChange={(value) => setViewMode(value as typeof viewMode)}>
            <Select.Trigger className="select-trigger" aria-label="View mode">
              <Select.Value />
            </Select.Trigger>
            <Select.Content className="select-content" position="popper">
              <Select.Item value="split" className="select-item">
                <Select.ItemText>Default</Select.ItemText>
              </Select.Item>
              <Select.Item value="pdf" className="select-item">
                <Select.ItemText>PDF only</Select.ItemText>
              </Select.Item>
              <Select.Item value="translation" className="select-item">
                <Select.ItemText>Translation only</Select.ItemText>
              </Select.Item>
            </Select.Content>
          </Select.Root>
          <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
            <Dialog.Trigger asChild>
              <Toolbar.Button className="btn btn-primary">Settings</Toolbar.Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content dialog-content-settings">
                <Dialog.Title className="dialog-title">Settings</Dialog.Title>
                <Dialog.Description className="dialog-description">
                  Configure translation preferences and appearance.
                </Dialog.Description>
                <div className="settings-content">
                  {/* Appearance Section */}
                  <div className="settings-section">
                    <div className="settings-section-header">
                      <span className="settings-section-icon">🎨</span>
                      <span>Appearance</span>
                    </div>
                    <div className="settings-item">
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
                            <Select.ItemText>System</Select.ItemText>
                          </Select.Item>
                          <Select.Item value="light" className="select-item">
                            <Select.ItemText>Light</Select.ItemText>
                          </Select.Item>
                          <Select.Item value="dark" className="select-item">
                            <Select.ItemText>Dark</Select.ItemText>
                          </Select.Item>
                        </Select.Content>
                      </Select.Root>
                      <span className="settings-hint">Choose your preferred color scheme</span>
                    </div>
                  </div>

                  {/* Translation Section */}
                  <div className="settings-section">
                    <div className="settings-section-header">
                      <span className="settings-section-icon">🌐</span>
                      <span>Translation</span>
                    </div>
                    <div className="settings-item">
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
                      <span className="settings-hint">Language for translations</span>
                    </div>
                    <div className="settings-item">
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
                      <span className="settings-hint">e.g. openai/gpt-4o-mini, anthropic/claude-3-haiku</span>
                    </div>
                  </div>

                  {/* API Configuration Section */}
                  <div className="settings-section">
                    <div className="settings-section-header">
                      <span className="settings-section-icon">🔑</span>
                      <span>API Configuration</span>
                    </div>
                    <div className="settings-item">
                      <Label.Root className="settings-label" htmlFor="api-key-input">
                        OpenRouter API Key
                      </Label.Root>
                      <div className="api-key-row">
                        <input
                          id="api-key-input"
                          className="input"
                          type="password"
                          placeholder="sk-or-..."
                          value={apiKeyInput}
                          onChange={(event) => setApiKeyInput(event.target.value)}
                        />
                        <button
                          className="btn"
                          type="button"
                          disabled={apiKeySaving}
                          onClick={async () => {
                            if (!apiKeyInput.trim()) {
                              setApiKeyStatus("Please enter an API key.");
                              return;
                            }
                            setApiKeySaving(true);
                            setApiKeyStatus("");
                            try {
                              await invoke("save_openrouter_key", { key: apiKeyInput });
                              setApiKeyStatus("Saved. Key stored locally.");
                              setApiKeyInput("");
                              const info = await invoke<{ exists: boolean }>("get_openrouter_key_info");
                              setApiKeyExists(info.exists);
                            } catch (error) {
                              const message = String(error);
                              setApiKeyStatus(message ? `Failed to save key: ${message}` : "Failed to save key.");
                            } finally {
                              setApiKeySaving(false);
                            }
                          }}
                        >
                          Save
                        </button>
                        <button
                          className="btn"
                          type="button"
                          disabled={apiKeyTesting}
                          onClick={async () => {
                            setApiKeyTesting(true);
                            setApiKeyStatus("");
                            try {
                              await invoke("test_openrouter_key");
                              setApiKeyStatus("Connection OK.");
                            } catch (error) {
                              const message = String(error);
                              setApiKeyStatus(
                                message ? `Connection failed: ${message}` : "Connection failed."
                              );
                            } finally {
                              setApiKeyTesting(false);
                            }
                          }}
                        >
                          Test
                        </button>
                      </div>
                      <div className="api-key-status">
                        {apiKeyExists ? (
                          <span className="status-ok">Key saved</span>
                        ) : (
                          <span className="status-warn">No key saved yet</span>
                        )}
                        {apiKeyStatus && <span className="status-message">{apiKeyStatus}</span>}
                      </div>
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="settings-link"
                      >
                        Get API Key →
                      </a>
                    </div>
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button className="btn btn-primary">Done</button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </Toolbar.Root>
      <main
        className={`app-main ${viewMode === "pdf" ? "is-pdf-only" : ""} ${
          viewMode === "translation" ? "is-translation-only" : ""
        }`}
      >
        {viewMode !== "translation" ? (
          <section className="pane pane-left">
            {pdfDoc ? (
            <PdfViewer
              pdfDoc={pdfDoc}
              pages={pages}
              pageSizes={pageSizes}
              scale={scale}
              highlightSid={highlightSid}
              onCurrentPageChange={setCurrentPage}
              scrollToPage={scrollToPage}
            />
            ) : (
              <div className="empty-state">No PDF loaded.</div>
            )}
          </section>
        ) : null}
        {viewMode !== "pdf" ? (
          <section className="pane pane-right">
            <div className="pane-body">
              {pdfDoc ? (
              <TranslationPane
                pages={pages}
                activeSid={activeSid}
                hoverSid={hoverSid}
                onHoverSid={setHoverSid}
                onActiveSid={setActiveSid}
                onTranslateSid={handleTranslateSid}
                onTranslateWord={handleTranslateWord}
                wordTranslation={wordTranslation}
                onClearWordTranslation={handleClearWordTranslation}
                onSelectPage={(page) => {
                  setCurrentPage(page);
                  setScrollToPage(page);
                }}
              />
              ) : (
                <div className="empty-state">Translations will appear here.</div>
              )}
            </div>
            <div className="side-footer">OpenRouter translation via Tauri backend.</div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
