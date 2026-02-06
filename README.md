# PDFRead

A Tauri desktop PDF bilingual reader with sentence-level alignment and translation.

![PDFRead App Icon](./appicon.png)

## Highlights

- Two-column layout: PDF on the left, translations and controls on the right.
- Sentence-level translation with alignment highlights on the PDF.
- Local cache for translations, powered by OpenRouter via the Rust backend.
- Smooth scrolling and virtualization for long documents.

## Install (Homebrew)

```bash
brew tap everettjf/tap
brew install --cask pdfread
```

## Develop

### Tauri + React + TypeScript

```bash
bun install
bun run tauri dev
```

### Build

```bash
bun run build
```

## Recommended IDE Setup

- VS Code + Tauri extension + rust-analyzer

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=everettjf/PDFRead&type=Date)](https://star-history.com/#everettjf/PDFRead&Date)
