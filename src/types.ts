export type Rect = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Sentence = {
  sid: string;
  page: number;
  source: string;
  translation?: string;
  status: "idle" | "loading" | "done" | "error";
  rects: Rect[];
};

export type PageDoc = {
  page: number;
  sentences: Sentence[];
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
