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
import * as Tooltip from "@radix-ui/react-tooltip";
import { PdfViewer } from "./components/PdfViewer";
import { TranslationPane } from "./components/TranslationPane";
import { EpubViewer } from "./components/document/EpubViewer";
import { ChatPanel } from "./components/reader/ChatPanel";
import { HomeView } from "./views/HomeView";
import { extractPageParagraphs } from "./lib/textExtraction";
import { hashBuffer } from "./lib/hash";
import { LRUCache } from "./lib/lruCache";
import type { PageDoc, TranslationSettings, WordTranslation, WordDefinition, VocabularyEntry, RecentBook, FileType } from "./types";
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

type AppView = "home" | "reader";

export default function App() {
  const [appView, setAppView] = useState<AppView>("home");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentFileType, setCurrentFileType] = useState<FileType>("pdf");
  const [epubData, setEpubData] = useState<Uint8Array | null>(null);
  const [epubTotalPages, setEpubTotalPages] = useState<number>(1);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[]>([]);
  const [pages, setPages] = useState<PageDoc[]>([]);
  const [docId, setDocId] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [settings, setSettings] = useState<TranslationSettings>(DEFAULT_SETTINGS);
  const [hoverPid, setHoverPid] = useState<string | null>(null);
  const [activePid, setActivePid] = useState<string | null>(null);
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
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [vocabulary, setVocabulary] = useState<VocabularyEntry[]>([]);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const pagesRef = useRef<PageDoc[]>([]);
  const textTranslationCacheRef = useRef(new LRUCache<string, string>(100));
  const settingsRef = useRef(settings);
  const docIdRef = useRef(docId);
  const translationRequestId = useRef(0);
  const translatingRef = useRef(false);
  const debounceRef = useRef<number | undefined>(undefined);
  const translateQueueRef = useRef<string[]>([]);

  const highlightPid = hoverPid ?? activePid;

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

  const loadPdfFromPath = useCallback(async (filePath: string, startPage?: number) => {
    setAppView("reader");
    setCurrentFilePath(filePath);
    setCurrentFileType("pdf");
    setEpubData(null);
    setLoadingProgress(0);
    setStatusMessage("Loading PDF...");
    setPdfDoc(null);
    setPages([]);
    setPageSizes([]);
    translationRequestId.current = 0;
    translatingRef.current = false;
    translateQueueRef.current = [];
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    try {
      setLoadingProgress(5);
      const rawBytes = (await invoke("read_pdf_file", { path: filePath })) as number[];
      const bytes = new Uint8Array(rawBytes);
      const buffer = bytes.buffer.slice(0);
      const hash = await hashBuffer(buffer);
      const nextDocId = hash.slice(0, 12);

      setLoadingProgress(15);
      const loadingTask = pdfjsLib.getDocument({ data: bytes });
      const doc = await loadingTask.promise;

      setLoadingProgress(25);
      const sizes: { width: number; height: number }[] = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        sizes.push({ width: viewport.width, height: viewport.height });
        setLoadingProgress(25 + Math.round((i / doc.numPages) * 25));
      }

      const initialPages: PageDoc[] = sizes.map((_, index) => ({ page: index + 1, paragraphs: [] }));

      // Extract filename and title from path
      const fileName = filePath.split(/[/\\]/).pop() || "Untitled";
      const title = fileName.replace(/\.[^.]+$/, "");

      // Add to recent books
      try {
        await invoke("add_recent_book", {
          id: nextDocId,
          filePath: filePath,
          fileName: fileName,
          fileType: "pdf",
          title: title,
          author: null,
          coverImage: null,
          totalPages: doc.numPages,
        });
      } catch (error) {
        console.error("Failed to add to recent books:", error);
      }

      setPdfDoc(doc);
      setPageSizes(sizes);
      setPages(initialPages);
      setDocId(nextDocId);
      setCurrentPage(startPage || 1);
      if (startPage) {
        setScrollToPage(startPage);
      }
      setStatusMessage("Extracting text...");

      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const { paragraphs, watermarks } = await extractPageParagraphs(page, nextDocId, i - 1);
        setPages((prev) =>
          prev.map((entry) => (entry.page === i ? { ...entry, paragraphs, watermarks } : entry))
        );
        setLoadingProgress(50 + Math.round((i / doc.numPages) * 50));
      }
      setLoadingProgress(null);
      setStatusMessage("Ready. Click translate button or select text.");
    } catch (error) {
      console.error("Failed to load PDF:", error);
      setLoadingProgress(null);
      setStatusMessage("Failed to load PDF. The file may have been moved or deleted.");
      setAppView("home");
    }
  }, []);

  const loadEpubFromPath = useCallback(async (filePath: string, startPage?: number) => {
    setAppView("reader");
    setCurrentFilePath(filePath);
    setCurrentFileType("epub");
    setPdfDoc(null);
    setPageSizes([]);
    setLoadingProgress(0);
    setStatusMessage("Loading EPUB...");
    translationRequestId.current = 0;
    translatingRef.current = false;
    translateQueueRef.current = [];
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    try {
      const rawBytes = (await invoke("read_pdf_file", { path: filePath })) as number[];
      const bytes = new Uint8Array(rawBytes);
      const buffer = bytes.buffer.slice(0);
      const hash = await hashBuffer(buffer);
      const nextDocId = hash.slice(0, 12);

      // Extract filename and title from path
      const fileName = filePath.split(/[/\\]/).pop() || "Untitled";
      const title = fileName.replace(/\.[^.]+$/, "");

      setEpubData(bytes);
      setDocId(nextDocId);
      setCurrentPage(startPage || 1);
      setLoadingProgress(null);
      setStatusMessage("Ready. Click translate button or select text.");

      // Add to recent books (will be updated with proper metadata from EPUB)
      try {
        await invoke("add_recent_book", {
          id: nextDocId,
          filePath: filePath,
          fileName: fileName,
          fileType: "epub",
          title: title,
          author: null,
          coverImage: null,
          totalPages: 1,
        });
      } catch (error) {
        console.error("Failed to add to recent books:", error);
      }
    } catch (error) {
      console.error("Failed to load EPUB:", error);
      setStatusMessage("Failed to load EPUB. The file may have been moved or deleted.");
      setLoadingProgress(null);
      setAppView("home");
    }
  }, []);

  const handleEpubMetadata = useCallback(async (metadata: { title: string; author?: string; coverImage?: string }) => {
    // Update recent book with proper metadata
    if (docId) {
      try {
        await invoke("add_recent_book", {
          id: docId,
          filePath: currentFilePath,
          fileName: currentFilePath?.split(/[/\\]/).pop() || "Untitled",
          fileType: "epub",
          title: metadata.title,
          author: metadata.author || null,
          coverImage: metadata.coverImage || null,
          totalPages: epubTotalPages,
        });
      } catch (error) {
        console.error("Failed to update recent book metadata:", error);
      }
    }
  }, [docId, currentFilePath, epubTotalPages]);

  const handleEpubParagraphs = useCallback((paragraphs: any[]) => {
    // Convert EPUB paragraphs to PageDoc format
    const epubPage: PageDoc = {
      page: 1,
      paragraphs: paragraphs.map((p) => ({
        pid: p.pid,
        page: 1,
        source: p.source,
        translation: p.translation,
        status: p.status,
        rects: [],
      })),
    };
    setPages([epubPage]);
  }, []);

  const handleEpubPageChange = useCallback((page: number, total: number) => {
    setCurrentPage(page);
    setEpubTotalPages(total);
  }, []);

  const handleOpenFile = useCallback(async () => {
    const selection = await open({
      multiple: false,
      filters: [{ name: "Documents", extensions: ["pdf", "epub"] }],
    });

    if (!selection || Array.isArray(selection)) return;

    const ext = selection.split('.').pop()?.toLowerCase();
    if (ext === 'epub') {
      await loadEpubFromPath(selection);
    } else {
      await loadPdfFromPath(selection);
    }
  }, [loadPdfFromPath, loadEpubFromPath]);

  const handleOpenBook = useCallback(async (book: RecentBook) => {
    if (book.fileType === 'epub') {
      await loadEpubFromPath(book.filePath, book.lastPage);
    } else {
      await loadPdfFromPath(book.filePath, book.lastPage);
    }
  }, [loadPdfFromPath, loadEpubFromPath]);

  const handleBackToHome = useCallback(() => {
    // Save progress before leaving
    if (docId && pdfDoc) {
      const progress = (currentPage / pdfDoc.numPages) * 100;
      invoke("update_book_progress", {
        id: docId,
        lastPage: currentPage,
        progress: progress,
      }).catch(console.error);
    }
    setAppView("home");
    setPdfDoc(null);
    setPages([]);
    setPageSizes([]);
    setCurrentFilePath(null);
    setChatOpen(false);
  }, [docId, pdfDoc, currentPage]);

  // Helper functions for chat context
  const getCurrentPageText = useCallback(() => {
    const currentPageDoc = pages.find((p) => p.page === currentPage);
    if (!currentPageDoc) return "";
    return currentPageDoc.paragraphs.map((p) => p.source).join("\n\n");
  }, [pages, currentPage]);

  const getSurroundingPagesText = useCallback(() => {
    const radius = 3;
    const startPage = Math.max(1, currentPage - radius);
    const endPage = Math.min(pages.length, currentPage + radius);

    return pages
      .filter((p) => p.page >= startPage && p.page <= endPage)
      .map((p) => `--- Page ${p.page} ---\n${p.paragraphs.map((para) => para.source).join("\n\n")}`)
      .join("\n\n");
  }, [pages, currentPage]);

  const runTranslateQueue = useCallback(async () => {
    if (translatingRef.current) return;
    if (!docIdRef.current) return;

    const uniqueQueue = Array.from(new Set(translateQueueRef.current));
    translateQueueRef.current = [];
    if (uniqueQueue.length === 0) return;

    const pending = pagesRef.current
      .flatMap((page) => page.paragraphs)
      .filter(
        (para) =>
          uniqueQueue.includes(para.pid) &&
          (para.status === "idle" || para.status === "error")
      );

    if (pending.length === 0) return;

    translatingRef.current = true;
    const requestId = ++translationRequestId.current;

    setPages((prev) =>
      prev.map((page) => ({
        ...page,
        paragraphs: page.paragraphs.map((para) =>
          pending.some((item) => item.pid === para.pid)
            ? { ...para, status: "loading" as const }
            : para
        ),
      }))
    );

    try {
      const payload = pending.map((para) => ({ sid: para.pid, text: para.source }));
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
        60000
      )) as { sid: string; translation: string }[];

      if (translationRequestId.current !== requestId) {
        setPages((prev) =>
          prev.map((page) => ({
            ...page,
            paragraphs: page.paragraphs.map((para) =>
              pending.some((item) => item.pid === para.pid) && para.status === "loading"
                ? { ...para, status: "idle" as const }
                : para
            ),
          }))
        );
        return;
      }

      const translationMap = new Map(results.map((item) => [item.sid, item.translation]));
      setPages((prev) =>
        prev.map((page) => ({
          ...page,
          paragraphs: page.paragraphs.map((para) => {
            if (!pending.some((item) => item.pid === para.pid)) return para;
            const translation = translationMap.get(para.pid);
            if (!translation) {
              return { ...para, status: "error" as const };
            }
            return { ...para, translation, status: "done" as const };
          }),
        }))
      );
    } catch (error) {
      setPages((prev) =>
        prev.map((page) => ({
          ...page,
          paragraphs: page.paragraphs.map((para) =>
            pending.some((item) => item.pid === para.pid)
              ? { ...para, status: "error" as const }
              : para
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

  const handleTranslatePid = useCallback(
    (pid: string, forceRetry = false) => {
      if (!docIdRef.current) return;
      const para = pagesRef.current
        .flatMap((page) => page.paragraphs)
        .find((item) => item.pid === pid);
      if (!para) return;
      // Allow retry for error status, or force retry
      if (para.status === "loading") return;
      if (para.status === "done" && !forceRetry) return;

      translateQueueRef.current = Array.from(new Set([...translateQueueRef.current, pid]));
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void runTranslateQueue();
      }, 400);
    },
    [runTranslateQueue]
  );

  const handleLocatePid = useCallback(
    (pid: string, page: number) => {
      setActivePid(pid);
      setScrollToPage(page);
    },
    []
  );

  const handleTranslateText = useCallback(
    async (text: string, position: { x: number; y: number }) => {
      const normalizedText = text.toLowerCase().trim();
      const isSingleWord = /^[a-zA-Z]+$/.test(text.trim());

      // Check if word is in vocabulary
      let isLiked = false;
      if (isSingleWord) {
        try {
          isLiked = await invoke<boolean>("is_word_in_vocabulary", { word: text });
        } catch {
          // Ignore error
        }
      }

      // Check cache first
      const cached = textTranslationCacheRef.current.get(normalizedText);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setWordTranslation({ word: text, ...parsed, position, isLiked });
        } catch {
          setWordTranslation({ word: text, definitions: [{ pos: "", meanings: cached }], position, isLiked });
        }
        return;
      }

      // Show loading state
      setWordTranslation({ word: text, definitions: [], position, isLoading: true, isLiked });

      try {
        const currentSettings = settingsRef.current;

        if (isSingleWord) {
          // Use dictionary lookup for single words
          const result = (await invoke("openrouter_word_lookup", {
            model: currentSettings.model,
            targetLanguage: currentSettings.targetLanguage,
            word: text,
          })) as { phonetic?: string; definitions: WordDefinition[] };

          // Cache the result
          textTranslationCacheRef.current.set(normalizedText, JSON.stringify(result));

          setWordTranslation({
            word: text,
            phonetic: result.phonetic,
            definitions: result.definitions || [],
            position,
            isLiked,
          });
        } else {
          // Use regular translation for phrases
          const results = (await invoke("openrouter_translate", {
            model: currentSettings.model,
            temperature: currentSettings.temperature,
            targetLanguage: currentSettings.targetLanguage,
            sentences: [{ sid: "text", text }],
          })) as { sid: string; translation: string }[];

          const translation = results[0]?.translation || "Translation failed";

          // Cache the result
          textTranslationCacheRef.current.set(normalizedText, translation);

          setWordTranslation({
            word: text,
            definitions: [{ pos: "", meanings: translation }],
            position,
            isLiked,
          });
        }
      } catch (error) {
        setWordTranslation({
          word: text,
          definitions: [{ pos: "", meanings: "Translation failed" }],
          position,
          isLiked,
        });
      }
    },
    []
  );

  const handleClearWordTranslation = useCallback(() => {
    setWordTranslation(null);
  }, []);

  const loadVocabulary = useCallback(async () => {
    try {
      const words = await invoke<VocabularyEntry[]>("get_vocabulary");
      setVocabulary(words);
    } catch (error) {
      console.error("Failed to load vocabulary:", error);
    }
  }, []);

  const handleToggleLikeWord = useCallback(async (word: WordTranslation) => {
    try {
      if (word.isLiked) {
        await invoke("remove_vocabulary_word", { word: word.word });
        setWordTranslation((prev) => prev ? { ...prev, isLiked: false } : null);
      } else {
        await invoke("add_vocabulary_word", {
          word: word.word,
          phonetic: word.phonetic || null,
          definitions: word.definitions,
        });
        setWordTranslation((prev) => prev ? { ...prev, isLiked: true } : null);
      }
    } catch (error) {
      console.error("Failed to toggle vocabulary word:", error);
    }
  }, []);

  const handleExportVocabulary = useCallback(async () => {
    try {
      const markdown = await invoke<string>("export_vocabulary_markdown");
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vocabulary.md";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export vocabulary:", error);
    }
  }, []);

  useEffect(() => {
    if (vocabularyOpen) {
      loadVocabulary();
    }
  }, [vocabularyOpen, loadVocabulary]);

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

  // Save progress when page changes
  useEffect(() => {
    if (docId && pdfDoc && currentPage > 0) {
      const progress = (currentPage / pdfDoc.numPages) * 100;
      invoke("update_book_progress", {
        id: docId,
        lastPage: currentPage,
        progress: progress,
      }).catch(() => {});
    }
  }, [docId, pdfDoc, currentPage]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Cmd/Ctrl + O: Open file
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
        return;
      }

      // Cmd/Ctrl + K: Toggle AI Chat
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setChatOpen((prev) => !prev);
        return;
      }

      // Escape: Close chat panel or go back to home
      if (e.key === "Escape") {
        if (chatOpen) {
          setChatOpen(false);
        } else if (appView === "reader") {
          handleBackToHome();
        }
        return;
      }

      // Zoom shortcuts (when in reader)
      if (appView === "reader") {
        // Cmd/Ctrl + Plus: Zoom in
        if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
          e.preventDefault();
          const nextIndex = Math.min(ZOOM_LEVELS.length - 1, currentScaleIndex + 1);
          setScale(ZOOM_LEVELS[nextIndex]);
          return;
        }

        // Cmd/Ctrl + Minus: Zoom out
        if ((e.metaKey || e.ctrlKey) && e.key === "-") {
          e.preventDefault();
          const nextIndex = Math.max(0, currentScaleIndex - 1);
          setScale(ZOOM_LEVELS[nextIndex]);
          return;
        }

        // Cmd/Ctrl + 0: Reset zoom
        if ((e.metaKey || e.ctrlKey) && e.key === "0") {
          e.preventDefault();
          setScale(1);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appView, chatOpen, currentScaleIndex, handleOpenFile, handleBackToHome]);

  // Show home view
  if (appView === "home") {
    return <HomeView onOpenBook={handleOpenBook} onOpenFile={handleOpenFile} />;
  }

  return (
    <Tooltip.Provider delayDuration={300}>
    <div className="app-shell">
      <Toolbar.Root className="app-header" aria-label="Toolbar">
        <div className="header-left">
          <Toolbar.Button className="btn btn-ghost" onClick={handleBackToHome} title="Back to Library">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Toolbar.Button>
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
          <Toolbar.Button className="btn" onClick={handleOpenFile}>
            Open File
          </Toolbar.Button>
          <div className="status-area">
            <div className="status-text">{statusMessage}</div>
            {loadingProgress !== null && (
              <div className="loading-bar">
                <div
                  className="loading-bar-fill"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            )}
          </div>
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
              <Toolbar.Button className="btn btn-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Settings</span>
              </Toolbar.Button>
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
          <Dialog.Root open={vocabularyOpen} onOpenChange={setVocabularyOpen}>
            <Dialog.Trigger asChild>
              <Toolbar.Button className="btn btn-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M8 7h8M8 11h8M8 15h5" />
                </svg>
                <span>Vocabulary</span>
              </Toolbar.Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content dialog-content-vocabulary">
                <Dialog.Title className="dialog-title">Vocabulary</Dialog.Title>
                <Dialog.Description className="dialog-description">
                  Words you've saved while reading.
                </Dialog.Description>
                <div className="vocabulary-content">
                  {vocabulary.length === 0 ? (
                    <div className="vocabulary-empty">
                      No words saved yet. Click the heart icon on word translations to add them here.
                    </div>
                  ) : (
                    <ScrollArea.Root className="vocabulary-scroll">
                      <ScrollArea.Viewport className="vocabulary-list">
                        {vocabulary.map((entry) => (
                          <div key={entry.word} className="vocabulary-item">
                            <div className="vocabulary-item-header">
                              <span className="vocabulary-word">{entry.word}</span>
                              {entry.phonetic && (
                                <span className="vocabulary-phonetic">{entry.phonetic}</span>
                              )}
                            </div>
                            <div className="vocabulary-definitions">
                              {entry.definitions.map((def, idx) => (
                                <div key={idx} className="vocabulary-definition">
                                  {def.pos && <span className="vocabulary-pos">{def.pos}</span>}
                                  <span className="vocabulary-meanings">{def.meanings}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
                        <ScrollArea.Thumb className="scrollbar-thumb" />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  )}
                </div>
                <div className="vocabulary-actions">
                  <button
                    className="btn"
                    onClick={handleExportVocabulary}
                    disabled={vocabulary.length === 0}
                  >
                    Export Markdown
                  </button>
                  <Dialog.Close asChild>
                    <button className="btn btn-primary">Done</button>
                  </Dialog.Close>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Toolbar.Button
                className={`btn btn-icon ${chatOpen ? "btn-primary" : ""}`}
                onClick={() => setChatOpen(!chatOpen)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <path d="M8 10h.01M12 10h.01M16 10h.01" />
                </svg>
                <span>AI Chat</span>
              </Toolbar.Button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip-content" sideOffset={5}>
                AI Chat (⌘K)
                <Tooltip.Arrow className="tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </Toolbar.Root>
      <main
        className={`app-main ${viewMode === "pdf" ? "is-pdf-only" : ""} ${
          viewMode === "translation" ? "is-translation-only" : ""
        } ${chatOpen ? "has-chat" : ""}`}
      >
        {viewMode !== "translation" ? (
          <section className="pane pane-left">
            {currentFileType === "epub" && epubData ? (
              <EpubViewer
                fileData={epubData}
                onMetadata={handleEpubMetadata}
                onParagraphsExtracted={handleEpubParagraphs}
                onCurrentPageChange={handleEpubPageChange}
                scale={scale}
              />
            ) : pdfDoc ? (
              <PdfViewer
                pdfDoc={pdfDoc}
                pages={pages}
                pageSizes={pageSizes}
                scale={scale}
                highlightPid={highlightPid}
                onCurrentPageChange={setCurrentPage}
                scrollToPage={scrollToPage}
              />
            ) : (
              <div className="empty-state">No document loaded.</div>
            )}
          </section>
        ) : null}
        {viewMode !== "pdf" ? (
          <section className="pane pane-right">
            <div className="pane-body">
              {(pdfDoc || epubData) ? (
              <TranslationPane
                pages={pages}
                activePid={activePid}
                hoverPid={hoverPid}
                onHoverPid={setHoverPid}
                onTranslatePid={handleTranslatePid}
                onLocatePid={handleLocatePid}
                onTranslateText={handleTranslateText}
                wordTranslation={wordTranslation}
                onClearWordTranslation={handleClearWordTranslation}
                onToggleLikeWord={handleToggleLikeWord}
              />
              ) : (
                <div className="empty-state">Translations will appear here.</div>
              )}
            </div>
          </section>
        ) : null}
      </main>
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        model={settings.model}
        getCurrentPageText={getCurrentPageText}
        getSurroundingPagesText={getSurroundingPagesText}
      />
    </div>
    </Tooltip.Provider>
  );
}
