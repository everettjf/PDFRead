import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Dialog from "@radix-ui/react-dialog";
import * as Label from "@radix-ui/react-label";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { RecentBook, TranslationSettings } from "../types";
import appIcon from "../../appicon.png";

type HomeViewProps = {
  onOpenBook: (book: RecentBook) => void;
  onOpenFile: () => void;
  settings: TranslationSettings;
  onSettingsChange: (settings: TranslationSettings) => void;
};

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

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#e74c3c" opacity="0.15" />
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#e74c3c" strokeWidth="1.5" fill="none" />
      <polyline points="14 2 14 8 20 8" stroke="#e74c3c" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function EpubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="#27ae60" opacity="0.15" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="#27ae60" strokeWidth="1.5" fill="none" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="#27ae60" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

const MOTIVATIONAL_QUOTES = [
  "Every page turns into wisdom",
  "Knowledge has no boundaries",
  "Read more, understand deeper",
  "Expand your horizons today",
  "Words connect worlds",
  "Learning never stops",
  "Discover something new",
  "Feed your curiosity",
  "Books open doors",
  "Grow with every chapter",
  "Your reading journey awaits",
  "Unlock new perspectives",
  "Stories shape minds",
  "Embrace the joy of reading",
  "One book at a time",
  "Explore beyond limits",
  "Knowledge is power",
  "Read, learn, evolve",
  "Adventure begins here",
  "Transform through reading",
];

function getRandomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function HomeView({ onOpenBook, onOpenFile, settings, onSettingsChange }: HomeViewProps) {
  const [books, setBooks] = useState<RecentBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"translation" | "appearance" | "api">("appearance");
  const [languageListOpen, setLanguageListOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyExists, setApiKeyExists] = useState(false);
  const [apiKeyTesting, setApiKeyTesting] = useState(false);
  const [quote] = useState(() => getRandomQuote());
  const settingsTabsRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!settingsOpen) return;
    setSettingsTab("appearance");
    setLanguageListOpen(false);
    setApiKeyStatus("");
    invoke<{ exists: boolean }>("get_openrouter_key_info")
      .then((info) => setApiKeyExists(info.exists))
      .catch(() => setApiKeyExists(false));
  }, [settingsOpen]);

  const handleRemove = useCallback(async (book: RecentBook) => {
    try {
      await invoke("remove_recent_book", { id: book.id });
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
    } catch (error) {
      console.error("Failed to remove book:", error);
    }
  }, []);

  const hasBooks = !loading && books.length > 0;

  const handleSettingsTabChange = useCallback((value: string) => {
    const nextTab = value as "translation" | "appearance" | "api";
    setSettingsTab(nextTab);
    if (nextTab !== "translation") {
      setLanguageListOpen(false);
    }
    window.requestAnimationFrame(() => {
      const activeContent = settingsTabsRef.current?.querySelector<HTMLElement>(
        ".settings-content[data-state='active']"
      );
      activeContent?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, []);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="home">
        <header className="home-header">
          <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Dialog.Trigger asChild>
                  <button className="home-settings-btn">
                    <SettingsIcon />
                  </button>
                </Dialog.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip-content" sideOffset={5}>
                  Settings
                  <Tooltip.Arrow className="tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content dialog-content-settings">
                <Dialog.Title className="dialog-title">Settings</Dialog.Title>
                <Dialog.Description className="dialog-description">
                  Configure translation and appearance.
                </Dialog.Description>
                <Tabs.Root
                  ref={settingsTabsRef}
                  className="settings-tabs"
                  value={settingsTab}
                  onValueChange={handleSettingsTabChange}
                >
                  <Tabs.List className="settings-tabs-list" aria-label="Settings sections">
                    <Tabs.Trigger className="settings-tab-trigger" value="translation">
                      Translation
                    </Tabs.Trigger>
                    <Tabs.Trigger className="settings-tab-trigger" value="appearance">
                      Appearance
                    </Tabs.Trigger>
                    <Tabs.Trigger className="settings-tab-trigger" value="api">
                      API
                    </Tabs.Trigger>
                  </Tabs.List>

                  <Tabs.Content className="settings-content" value="translation">
                    <div className="settings-section">
                      <div className="settings-section-header">Translation</div>
                      <div className="settings-item">
                        <Label.Root className="settings-label">Target Language</Label.Root>
                        <button
                          type="button"
                          className="settings-language-toggle"
                          onClick={() => setLanguageListOpen((prev) => !prev)}
                        >
                          {languageListOpen ? "Hide language presets" : "Choose from presets"}
                        </button>
                        {languageListOpen ? (
                          <ScrollArea.Root className="settings-language-scroll">
                            <ScrollArea.Viewport className="settings-language-list">
                              {LANGUAGE_PRESETS.map((preset) => (
                                <button
                                  key={preset.code}
                                  className={`settings-language-item ${
                                    preset.code === settings.targetLanguage.code ? "is-selected" : ""
                                  }`}
                                  type="button"
                                  onClick={() => {
                                    onSettingsChange({
                                      ...settings,
                                      targetLanguage: { label: preset.label, code: preset.code },
                                    });
                                    setLanguageListOpen(false);
                                  }}
                                >
                                  <span>{preset.label}</span>
                                </button>
                              ))}
                            </ScrollArea.Viewport>
                            <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
                              <ScrollArea.Thumb className="scrollbar-thumb" />
                            </ScrollArea.Scrollbar>
                          </ScrollArea.Root>
                        ) : null}
                        <span className="settings-hint">
                          Selected: {settings.targetLanguage.label}
                        </span>
                      </div>
                      <div className="settings-item">
                        <Label.Root className="settings-label" htmlFor="home-language-label-input">
                          Language Label
                        </Label.Root>
                        <input
                          id="home-language-label-input"
                          className="input"
                          value={settings.targetLanguage.label}
                          onChange={(e) =>
                            onSettingsChange({
                              ...settings,
                              targetLanguage: { ...settings.targetLanguage, label: e.target.value },
                            })
                          }
                        />
                      </div>
                      <div className="settings-item">
                        <Label.Root className="settings-label" htmlFor="home-model-input">
                          Model
                        </Label.Root>
                        <input
                          id="home-model-input"
                          className="input"
                          value={settings.model}
                          onChange={(e) => onSettingsChange({ ...settings, model: e.target.value })}
                        />
                        <span className="settings-hint">e.g. openai/gpt-4o-mini</span>
                      </div>
                    </div>
                  </Tabs.Content>

                  <Tabs.Content className="settings-content" value="appearance">
                    <div className="settings-section">
                      <div className="settings-section-header">Appearance</div>
                      <div className="settings-item">
                        <Label.Root className="settings-label">Theme</Label.Root>
                        <Select.Root
                          value={settings.theme}
                          onValueChange={(value) =>
                            onSettingsChange({ ...settings, theme: value as TranslationSettings["theme"] })
                          }
                        >
                          <Select.Trigger className="select-trigger">
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
                      </div>
                    </div>
                  </Tabs.Content>

                  <Tabs.Content className="settings-content" value="api">
                    <div className="settings-section">
                      <div className="settings-section-header">API</div>
                      <div className="settings-item">
                        <Label.Root className="settings-label">OpenRouter Key</Label.Root>
                        <div className="api-key-row">
                          <input
                            className="input"
                            type="password"
                            placeholder="sk-or-..."
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                          />
                          <button
                            className="btn"
                            disabled={apiKeySaving}
                            onClick={async () => {
                              if (!apiKeyInput.trim()) return;
                              setApiKeySaving(true);
                              try {
                                await invoke("save_openrouter_key", { key: apiKeyInput });
                                setApiKeyStatus("Saved");
                                setApiKeyInput("");
                                const info = await invoke<{ exists: boolean }>("get_openrouter_key_info");
                                setApiKeyExists(info.exists);
                              } catch {
                                setApiKeyStatus("Failed");
                              } finally {
                                setApiKeySaving(false);
                              }
                            }}
                          >
                            Save
                          </button>
                          <button
                            className="btn"
                            disabled={apiKeyTesting}
                            onClick={async () => {
                              setApiKeyTesting(true);
                              try {
                                await invoke("test_openrouter_key");
                                setApiKeyStatus("OK");
                              } catch {
                                setApiKeyStatus("Failed");
                              } finally {
                                setApiKeyTesting(false);
                              }
                            }}
                          >
                            Test
                          </button>
                        </div>
                        <div className="api-key-status">
                          {apiKeyExists ? <span className="status-ok">Key saved</span> : <span className="status-warn">No key</span>}
                          {apiKeyStatus && <span className="status-message">{apiKeyStatus}</span>}
                        </div>
                        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="settings-link">Get API Key →</a>
                      </div>
                    </div>
                  </Tabs.Content>
                </Tabs.Root>
                <Dialog.Close asChild>
                  <button className="btn btn-primary">Done</button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </header>

        <main className="home-main">
          <div className="home-content">
            {/* Branding */}
            <div className="home-branding">
              <img src={appIcon} alt="PDFRead" className="home-logo-img" />
              <h1 className="home-title">PDFRead</h1>
              <p className="home-subtitle">{quote}</p>
            </div>

            {/* Drop zone */}
            <div className="home-dropzone" onClick={onOpenFile}>
              <UploadIcon />
              <div className="home-dropzone-text">
                <span className="home-dropzone-title">Open PDF or EPUB</span>
                <span className="home-dropzone-hint">Click to browse or drag file here</span>
              </div>
              <span className="home-dropzone-shortcut">⌘O</span>
            </div>

            {/* Recent files */}
            {loading ? (
              <div className="home-loading"><div className="home-spinner" /></div>
            ) : hasBooks ? (
              <div className="home-recent">
                <div className="home-recent-title">Recent</div>
                <ScrollArea.Root className="home-recent-scroll">
                  <ScrollArea.Viewport className="home-recent-viewport">
                    <div className="home-recent-list">
                      {books.map((book) => (
                        <ContextMenu.Root key={book.id}>
                          <ContextMenu.Trigger asChild>
                            <button className="home-file" onClick={() => onOpenBook(book)}>
                              <span className="home-file-icon">
                                {book.fileType === 'epub' ? <EpubIcon /> : <PdfIcon />}
                              </span>
                              <span className="home-file-info">
                                <span className="home-file-name">{book.title}</span>
                                <span className="home-file-meta">{Math.round(book.progress)}% · {formatRelativeTime(book.lastOpenedAt)}</span>
                              </span>
                            </button>
                          </ContextMenu.Trigger>
                          <ContextMenu.Portal>
                            <ContextMenu.Content className="context-menu">
                              <ContextMenu.Item className="context-menu-item context-menu-item-danger" onSelect={() => handleRemove(book)}>
                                <TrashIcon />
                                <span>Remove</span>
                              </ContextMenu.Item>
                            </ContextMenu.Content>
                          </ContextMenu.Portal>
                        </ContextMenu.Root>
                      ))}
                    </div>
                  </ScrollArea.Viewport>
                  <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
                    <ScrollArea.Thumb className="scrollbar-thumb" />
                  </ScrollArea.Scrollbar>
                </ScrollArea.Root>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </Tooltip.Provider>
  );
}
