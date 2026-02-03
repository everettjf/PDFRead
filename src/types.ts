export type Rect = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Paragraph = {
  pid: string;
  page: number;
  source: string;
  translation?: string;
  status: "idle" | "loading" | "done" | "error";
  rects: Rect[];
  epubHref?: string;
  sectionTitle?: string;
};

export type PageDoc = {
  page: number;
  paragraphs: Paragraph[];
  watermarks?: string[];
  title?: string; // Optional title for the page (e.g., chapter name for EPUB)
};

export type TargetLanguage = {
  label: string;
  code: string;
};

export type TranslationMode = "window" | "chunk";

export type ThemeMode = "system" | "light" | "dark";

export type TranslationSettings = {
  targetLanguage: TargetLanguage;
  model: string;
  temperature: number;
  mode: TranslationMode;
  radius: number;
  chunkSize: number;
  theme: ThemeMode;
};

export type WordDefinition = {
  pos: string; // part of speech: n., v., adj., etc.
  meanings: string;
};

export type WordTranslation = {
  word: string;
  phonetic?: string;
  definitions: WordDefinition[];
  position: { x: number; y: number };
  isLoading?: boolean;
  isLiked?: boolean;
};

export type VocabularyEntry = {
  word: string;
  phonetic?: string;
  definitions: WordDefinition[];
  added_at: string;
};

// Book/Library types
export type FileType = 'pdf' | 'epub';

export type RecentBook = {
  id: string;
  filePath: string;
  fileName: string;
  fileType: FileType;
  title: string;
  author?: string;
  coverImage?: string;
  totalPages: number;
  lastPage: number;
  progress: number;
  lastOpenedAt: string;
};

// Chat types
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};
