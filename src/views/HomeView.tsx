import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Dialog from "@radix-ui/react-dialog";
import * as Label from "@radix-ui/react-label";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { RecentBook, TranslationSettings } from "../types";

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

function AppLogo() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 3.5h8.5L19.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"
        fill="currentColor"
        opacity="0.12"
      />
      <path
        d="M6 3.5h8.5L19.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M14.5 3.5V8H19" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 12h8M8 15.5h6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="file-icon file-icon-pdf">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="currentColor" opacity="0.15" />
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function EpubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="file-icon file-icon-epub">
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="currentColor" opacity="0.15" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
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

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

export function HomeView({ onOpenBook, onOpenFile, settings, onSettingsChange }: HomeViewProps) {
  const [books, setBooks] = useState<RecentBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyExists, setApiKeyExists] = useState(false);
  const [apiKeyTesting, setApiKeyTesting] = useState(false);

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

  const targetPreset = LANGUAGE_PRESETS.find((item) => item.code === settings.targetLanguage.code);
  const languageTriggerLabel = targetPreset
    ? `${targetPreset.label} (${targetPreset.code})`
    : `Custom (${settings.targetLanguage.code || "code"})`;
  const filteredLanguages = languageQuery.trim()
    ? LANGUAGE_PRESETS.filter(
        (item) =>
          item.label.toLowerCase().includes(languageQuery.toLowerCase()) ||
          item.code.toLowerCase().includes(languageQuery.toLowerCase())
      )
    : LANGUAGE_PRESETS;

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="home-view">
        <header className="home-header">
          <div className="home-header-spacer" />
          <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Dialog.Trigger asChild>
                  <button className="btn btn-ghost btn-icon-only">
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
                  Configure translation preferences and appearance.
                </Dialog.Description>
                <div className="settings-content">
                  <div className="settings-section">
                    <div className="settings-section-header">
                      <span>Appearance</span>
                    </div>
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

                  <div className="settings-section">
                    <div className="settings-section-header">
                      <span>Translation</span>
                    </div>
                    <div className="settings-item">
                      <Label.Root className="settings-label">Target Language</Label.Root>
                      <Popover.Root open={languageOpen} onOpenChange={setLanguageOpen}>
                        <Popover.Trigger asChild>
                          <button className="select-trigger" type="button">
                            {languageTriggerLabel}
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content className="popover-content" sideOffset={8}>
                            <input
                              className="input popover-input"
                              placeholder="Search language..."
                              value={languageQuery}
                              onChange={(e) => setLanguageQuery(e.target.value)}
                            />
                            <ScrollArea.Root className="popover-scroll">
                              <ScrollArea.Viewport className="popover-list">
                                {filteredLanguages.map((preset) => (
                                  <button
                                    key={preset.code}
                                    className={`popover-item ${preset.code === settings.targetLanguage.code ? "is-selected" : ""}`}
                                    type="button"
                                    onClick={() => {
                                      onSettingsChange({
                                        ...settings,
                                        targetLanguage: { label: preset.label, code: preset.code },
                                      });
                                      setLanguageOpen(false);
                                    }}
                                  >
                                    <span>{preset.label}</span>
                                    <span className="popover-code">{preset.code}</span>
                                  </button>
                                ))}
                              </ScrollArea.Viewport>
                              <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
                                <ScrollArea.Thumb className="scrollbar-thumb" />
                              </ScrollArea.Scrollbar>
                            </ScrollArea.Root>
                            <Popover.Arrow className="popover-arrow" />
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    </div>
                    <div className="settings-item">
                      <Label.Root className="settings-label">Model</Label.Root>
                      <input
                        className="input"
                        value={settings.model}
                        onChange={(e) => onSettingsChange({ ...settings, model: e.target.value })}
                      />
                      <span className="settings-hint">e.g. openai/gpt-4o-mini</span>
                    </div>
                  </div>

                  <div className="settings-section">
                    <div className="settings-section-header">
                      <span>API Key</span>
                    </div>
                    <div className="settings-item">
                      <Label.Root className="settings-label">OpenRouter API Key</Label.Root>
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
                              setApiKeyStatus("Saved.");
                              setApiKeyInput("");
                              const info = await invoke<{ exists: boolean }>("get_openrouter_key_info");
                              setApiKeyExists(info.exists);
                            } catch (error) {
                              setApiKeyStatus(`Failed: ${error}`);
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
                              setApiKeyStatus(`Failed: ${error}`);
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
                          <span className="status-warn">No key</span>
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
        </header>

        <main className="home-main">
          <div className="home-center">
            <div className="home-logo">
              <AppLogo />
            </div>
            <h1 className="home-title">PDFRead</h1>
            <p className="home-subtitle">Read and translate PDF & EPUB files</p>

            <button className="btn btn-primary btn-lg home-open-btn" onClick={onOpenFile}>
              <FolderIcon />
              <span>Open File</span>
            </button>

            {loading ? (
              <div className="home-loading">
                <div className="home-loading-spinner" />
              </div>
            ) : books.length > 0 ? (
              <div className="home-recent">
                <div className="home-recent-header">Recent</div>
                <ScrollArea.Root className="home-recent-scroll">
                  <ScrollArea.Viewport className="home-recent-viewport">
                    <div className="home-recent-list">
                      {books.map((book) => (
                        <ContextMenu.Root key={book.id}>
                          <ContextMenu.Trigger asChild>
                            <button className="recent-item" onClick={() => onOpenBook(book)}>
                              <span className="recent-item-icon">
                                {book.fileType === 'epub' ? <EpubIcon /> : <PdfIcon />}
                              </span>
                              <span className="recent-item-info">
                                <span className="recent-item-title">{book.title}</span>
                                <span className="recent-item-meta">
                                  {Math.round(book.progress)}% · {formatRelativeTime(book.lastOpenedAt)}
                                </span>
                              </span>
                            </button>
                          </ContextMenu.Trigger>
                          <ContextMenu.Portal>
                            <ContextMenu.Content className="context-menu">
                              <ContextMenu.Item
                                className="context-menu-item context-menu-item-danger"
                                onSelect={() => handleRemove(book)}
                              >
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
