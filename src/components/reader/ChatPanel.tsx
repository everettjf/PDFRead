import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import type { ChatMessage } from "../../types";

type ChatPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  model: string;
  getCurrentPageText: () => string;
  getSurroundingPagesText: () => string;
};

const PRESET_QUESTIONS = [
  { label: "Summarize this page", prompt: "Please summarize the main points of this page in a clear and concise manner." },
  { label: "Key concepts", prompt: "What are the key concepts and important terms mentioned on this page? Please explain them briefly." },
  { label: "Summary of nearby pages", prompt: "Please provide a summary of the content across these pages, highlighting the main themes and how they connect." },
  { label: "Explain terms", prompt: "Please identify and explain any technical terms, jargon, or complex concepts found in this text." },
];

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </svg>
  );
}

export function ChatPanel({
  isOpen,
  onClose,
  model,
  getCurrentPageText,
  getSurroundingPagesText,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (userMessage: string, context: string) => {
    if (!userMessage.trim()) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await invoke<string>("chat_with_context", {
        model,
        context,
        question: userMessage,
      });

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${String(error)}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [model]);

  const handlePresetQuestion = useCallback((preset: typeof PRESET_QUESTIONS[0]) => {
    const context = preset.label.includes("nearby")
      ? getSurroundingPagesText()
      : getCurrentPageText();
    sendMessage(preset.prompt, context);
  }, [getCurrentPageText, getSurroundingPagesText, sendMessage]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const context = getCurrentPageText();
    sendMessage(input, context);
  }, [input, isLoading, getCurrentPageText, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  const handleClearChat = useCallback(() => {
    setMessages([]);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-title">
          <SparkleIcon />
          <span>AI Assistant</span>
        </div>
        <div className="chat-header-actions">
          {messages.length > 0 && (
            <button className="btn btn-ghost btn-small" onClick={handleClearChat}>
              Clear
            </button>
          )}
          <button className="chat-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="chat-presets">
        {PRESET_QUESTIONS.map((preset, index) => (
          <button
            key={index}
            className="chat-preset-btn"
            onClick={() => handlePresetQuestion(preset)}
            disabled={isLoading}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <ScrollArea.Root className="chat-messages-scroll">
        <ScrollArea.Viewport ref={scrollRef} className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>Ask questions about the current page or use the presets above.</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-message ${msg.role === "user" ? "is-user" : "is-assistant"}`}
              >
                <div className="chat-message-content">{msg.content}</div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="chat-message is-assistant">
              <div className="chat-message-content chat-loading">Thinking...</div>
            </div>
          )}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical" className="scrollbar">
          <ScrollArea.Thumb className="scrollbar-thumb" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask about this page..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={2}
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={!input.trim() || isLoading}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
