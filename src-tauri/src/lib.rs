use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use chrono::{DateTime, Utc};

#[derive(Debug, Deserialize)]
struct TargetLanguage {
    label: String,
    code: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct TranslateSentence {
    sid: String,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TranslationResult {
    sid: String,
    translation: String,
}

// Flexible struct to handle various LLM response formats
#[derive(Debug, Deserialize)]
struct FlexibleTranslationResult {
    sid: String,
    #[serde(alias = "translation", alias = "translated_text", alias = "text", alias = "translated")]
    translation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenRouterChoice {
    message: OpenRouterMessage,
}

#[derive(Debug, Deserialize)]
struct OpenRouterResponse {
    choices: Vec<OpenRouterChoice>,
}

#[derive(Debug, Deserialize, Serialize)]
struct CachedTranslations {
    entries: HashMap<String, String>,
}

fn app_config_dir(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    handle
        .path()
        .app_config_dir()
        .map_err(|_| "Failed to resolve app config directory.".to_string())
}

fn cache_file_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(handle)?.join("translation_cache.json"))
}

fn openrouter_key_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(handle)?.join("openrouter_key.txt"))
}

fn vocabulary_file_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(handle)?.join("vocabulary.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VocabularyEntry {
    word: String,
    phonetic: Option<String>,
    definitions: Vec<WordDefinitionResult>,
    added_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
struct VocabularyData {
    entries: Vec<VocabularyEntry>,
}

fn load_vocabulary(handle: &tauri::AppHandle) -> Result<VocabularyData, String> {
    let path = vocabulary_file_path(handle)?;
    if !path.exists() {
        return Ok(VocabularyData { entries: Vec::new() });
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn save_vocabulary(handle: &tauri::AppHandle, vocab: &VocabularyData) -> Result<(), String> {
    let path = vocabulary_file_path(handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(vocab).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

fn load_cache(handle: &tauri::AppHandle) -> Result<CachedTranslations, String> {
    let path = cache_file_path(handle)?;
    if !path.exists() {
        return Ok(CachedTranslations {
            entries: HashMap::new(),
        });
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn save_cache(handle: &tauri::AppHandle, cache: &CachedTranslations) -> Result<(), String> {
    let path = cache_file_path(handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

fn load_openrouter_key(handle: &tauri::AppHandle) -> Result<String, String> {
    let path = openrouter_key_path(handle)?;
    let key = fs::read_to_string(&path)
        .map_err(|_| format!("Missing OpenRouter API key at: {}", path.display()))?;
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("OpenRouter API key file is empty.".to_string());
    }
    Ok(trimmed.to_string())
}

#[derive(Debug, Serialize)]
struct KeyInfo {
    exists: bool,
}

#[tauri::command]
fn get_openrouter_key_info(handle: tauri::AppHandle) -> Result<KeyInfo, String> {
    let exists = load_openrouter_key(&handle).is_ok();
    Ok(KeyInfo { exists })
}

#[tauri::command]
fn save_openrouter_key(handle: tauri::AppHandle, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("OpenRouter API key is empty.".to_string());
    }
    let path = openrouter_key_path(&handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_openrouter_key(handle: tauri::AppHandle) -> Result<(), String> {
    let api_key = load_openrouter_key(&handle)?;
    let client = reqwest::Client::new();
    let response = client
        .get("https://openrouter.ai/api/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Err(format!("OpenRouter error: {} {}", status, text))
    }
}

fn build_system_prompt() -> String {
    [
        "You are a translation engine.",
        "Translate into the specified target language.",
        "Output STRICT JSON ONLY.",
        "No markdown, no explanations, no extra text.",
    ]
    .join(" ")
}

fn build_word_lookup_system_prompt() -> String {
    [
        "You are a dictionary lookup engine.",
        "Provide word definitions in dictionary format.",
        "Output STRICT JSON ONLY.",
        "No markdown, no explanations, no extra text.",
    ]
    .join(" ")
}

fn build_word_lookup_prompt(word: &str, target_language: &TargetLanguage) -> String {
    format!(
        r#"Look up the word "{}" and provide its definition in {} ({}).
Return JSON in this exact format:
{{"phonetic": "/phonetic transcription/", "definitions": [{{"pos": "n.", "meanings": "meaning1; meaning2"}}, {{"pos": "v.", "meanings": "meaning1; meaning2"}}]}}
- phonetic: IPA pronunciation
- definitions: array of objects with pos (part of speech like n., v., adj., adv., etc.) and meanings (translations separated by semicolons)
- Only include parts of speech that apply to this word
- Meanings should be in {}"#,
        word, target_language.label, target_language.code, target_language.label
    )
}

#[derive(Debug, Serialize, Deserialize)]
struct WordLookupResult {
    phonetic: Option<String>,
    definitions: Vec<WordDefinitionResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WordDefinitionResult {
    pos: String,
    meanings: String,
}

fn build_user_prompt(target_language: &TargetLanguage, sentences: &[TranslateSentence]) -> String {
    let payload = serde_json::to_string(sentences).unwrap_or_else(|_| "[]".to_string());
    format!(
        "Target language: {} ({})\nTranslation style: faithful, clear, readable\nInput JSON: {}",
        target_language.label, target_language.code, payload
    )
}

#[tauri::command]
fn read_pdf_file(path: String) -> Result<Vec<u8>, String> {
    let path_ref = std::path::Path::new(&path);

    // Check if the path is a directory (macOS treats some epub files as bundles)
    if path_ref.is_dir() {
        // If it's a directory (epub bundle), zip it into memory
        return zip_directory_to_bytes(path_ref);
    }

    fs::read(&path).map_err(|e| e.to_string())
}

fn zip_directory_to_bytes(dir_path: &std::path::Path) -> Result<Vec<u8>, String> {
    use std::io::{Read, Write};
    use walkdir::WalkDir;
    use zip::write::SimpleFileOptions;

    let mut buffer = std::io::Cursor::new(Vec::new());

    {
        let mut zip = zip::ZipWriter::new(&mut buffer);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for entry in WalkDir::new(dir_path) {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let relative_path = path.strip_prefix(dir_path)
                .map_err(|e| e.to_string())?;

            // Skip the root directory itself
            if relative_path.as_os_str().is_empty() {
                continue;
            }

            let relative_str = relative_path.to_string_lossy();

            if path.is_file() {
                zip.start_file(relative_str.to_string(), options)
                    .map_err(|e| e.to_string())?;
                let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
                let mut contents = Vec::new();
                file.read_to_end(&mut contents).map_err(|e| e.to_string())?;
                zip.write_all(&contents).map_err(|e| e.to_string())?;
            } else if path.is_dir() {
                // Add directory entry
                zip.add_directory(format!("{}/", relative_str), options)
                    .map_err(|e| e.to_string())?;
            }
        }

        zip.finish().map_err(|e| e.to_string())?;
    }

    Ok(buffer.into_inner())
}

async fn request_openrouter(
    api_key: &str,
    model: &str,
    temperature: f32,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "temperature": temperature,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ]
    });

    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OpenRouter error: {} {}", status, text));
    }

    let parsed: OpenRouterResponse = response.json().await.map_err(|e| e.to_string())?;
    let content = parsed
        .choices
        .first()
        .ok_or_else(|| "OpenRouter returned no choices.".to_string())?
        .message
        .content
        .clone();
    Ok(content)
}

fn parse_translation_json(content: &str) -> Result<Vec<TranslationResult>, String> {
    // Try to extract JSON array from the content (handle markdown code blocks)
    let json_content = extract_json_array(content);

    // Try flexible parsing first
    let parsed: Vec<FlexibleTranslationResult> = serde_json::from_str(&json_content)
        .map_err(|e| format!("{} (content: {})", e, truncate_for_error(&json_content)))?;

    // Convert to TranslationResult, filtering out items without translation
    let results: Vec<TranslationResult> = parsed
        .into_iter()
        .filter_map(|item| {
            item.translation.map(|t| TranslationResult {
                sid: item.sid,
                translation: t,
            })
        })
        .collect();

    Ok(results)
}

fn extract_json_array(content: &str) -> String {
    let trimmed = content.trim();

    // If it starts with [, it's already JSON
    if trimmed.starts_with('[') {
        return trimmed.to_string();
    }

    // Try to extract from markdown code block
    if let Some(start) = trimmed.find("```json") {
        if let Some(end) = trimmed[start..].find("```\n").or_else(|| trimmed[start..].rfind("```")) {
            let json_start = start + 7; // length of "```json"
            let json_end = start + end;
            if json_start < json_end {
                return trimmed[json_start..json_end].trim().to_string();
            }
        }
    }

    // Try to extract from generic code block
    if let Some(start) = trimmed.find("```") {
        let after_tick = &trimmed[start + 3..];
        if let Some(end) = after_tick.find("```") {
            // Skip optional language identifier on first line
            let block_content = &after_tick[..end];
            if let Some(newline) = block_content.find('\n') {
                return block_content[newline + 1..].trim().to_string();
            }
            return block_content.trim().to_string();
        }
    }

    // Try to find JSON array in the content
    if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            if start < end {
                return trimmed[start..=end].to_string();
            }
        }
    }

    trimmed.to_string()
}

fn truncate_for_error(s: &str) -> String {
    if s.len() > 200 {
        format!("{}...", &s[..200])
    } else {
        s.to_string()
    }
}

fn hash_source_text(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn extract_doc_id(sid: &str) -> &str {
    sid.split(':').next().unwrap_or(sid)
}

#[tauri::command(rename_all = "camelCase")]
async fn openrouter_translate(
    handle: tauri::AppHandle,
    model: String,
    temperature: f32,
    target_language: TargetLanguage,
    sentences: Vec<TranslateSentence>,
) -> Result<Vec<TranslationResult>, String> {
    if sentences.is_empty() {
        return Ok(Vec::new());
    }

    let mut cache = load_cache(&handle)?;
    let cache_key = |sid: &str, text: &str| {
        let doc_id = extract_doc_id(sid);
        let source_hash = hash_source_text(text);
        format!(
            "{}|{}|{}|{}|{}",
            doc_id, sid, source_hash, model, target_language.code
        )
    };

    let mut results: HashMap<String, String> = HashMap::new();
    let mut missing: Vec<TranslateSentence> = Vec::new();

    for sentence in sentences.iter() {
        if let Some(value) = cache.entries.get(&cache_key(&sentence.sid, &sentence.text)) {
            results.insert(sentence.sid.clone(), value.clone());
        } else {
            missing.push(TranslateSentence {
                sid: sentence.sid.clone(),
                text: sentence.text.clone(),
            });
        }
    }

    if !missing.is_empty() {
        let api_key = load_openrouter_key(&handle)?;
        let system_prompt = build_system_prompt();
        let user_prompt = build_user_prompt(&target_language, &missing);

        let mut content = request_openrouter(&api_key, &model, temperature, &system_prompt, &user_prompt).await?;
        let mut parsed = parse_translation_json(&content);

        if parsed.is_err() {
            let strict_user_prompt = format!(
                "Return ONLY this JSON array format with no extra text. Target language: {} ({})\nInput JSON: {}",
                target_language.label,
                target_language.code,
                serde_json::to_string(&missing).unwrap_or_else(|_| "[]".to_string())
            );
            content = request_openrouter(&api_key, &model, temperature, &system_prompt, &strict_user_prompt).await?;
            parsed = parse_translation_json(&content);
        }

        let translations = parsed.map_err(|e| format!("Failed to parse OpenRouter JSON: {}", e))?;
        for item in translations {
            let source_text = missing
                .iter()
                .find(|sentence| sentence.sid == item.sid)
                .map(|sentence| sentence.text.as_str())
                .unwrap_or("");
            cache
                .entries
                .insert(cache_key(&item.sid, source_text), item.translation.clone());
            results.insert(item.sid.clone(), item.translation);
        }
        save_cache(&handle, &cache)?;
    }

    let mut output: Vec<TranslationResult> = Vec::new();
    for sentence in sentences {
        if let Some(translation) = results.get(&sentence.sid) {
            output.push(TranslationResult {
                sid: sentence.sid,
                translation: translation.clone(),
            });
        }
    }

    Ok(output)
}

#[tauri::command(rename_all = "camelCase")]
async fn openrouter_word_lookup(
    handle: tauri::AppHandle,
    model: String,
    target_language: TargetLanguage,
    word: String,
) -> Result<WordLookupResult, String> {
    let api_key = load_openrouter_key(&handle)?;
    let system_prompt = build_word_lookup_system_prompt();
    let user_prompt = build_word_lookup_prompt(&word, &target_language);

    let content = request_openrouter(&api_key, &model, 0.0, &system_prompt, &user_prompt).await?;

    // Try to extract JSON from the response
    let json_content = extract_json_object(&content);

    let result: WordLookupResult = serde_json::from_str(&json_content)
        .map_err(|e| format!("Failed to parse word lookup JSON: {} (content: {})", e, truncate_for_error(&json_content)))?;

    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
fn add_vocabulary_word(
    handle: tauri::AppHandle,
    word: String,
    phonetic: Option<String>,
    definitions: Vec<WordDefinitionResult>,
) -> Result<(), String> {
    let mut vocab = load_vocabulary(&handle)?;

    // Check if word already exists (case-insensitive)
    let word_lower = word.to_lowercase();
    if vocab.entries.iter().any(|e| e.word.to_lowercase() == word_lower) {
        return Ok(()); // Already exists, don't add duplicate
    }

    vocab.entries.push(VocabularyEntry {
        word,
        phonetic,
        definitions,
        added_at: Utc::now(),
    });

    save_vocabulary(&handle, &vocab)
}

#[tauri::command(rename_all = "camelCase")]
fn remove_vocabulary_word(handle: tauri::AppHandle, word: String) -> Result<(), String> {
    let mut vocab = load_vocabulary(&handle)?;
    let word_lower = word.to_lowercase();
    vocab.entries.retain(|e| e.word.to_lowercase() != word_lower);
    save_vocabulary(&handle, &vocab)
}

#[tauri::command(rename_all = "camelCase")]
fn get_vocabulary(handle: tauri::AppHandle) -> Result<Vec<VocabularyEntry>, String> {
    let vocab = load_vocabulary(&handle)?;
    Ok(vocab.entries)
}

#[tauri::command(rename_all = "camelCase")]
fn is_word_in_vocabulary(handle: tauri::AppHandle, word: String) -> Result<bool, String> {
    let vocab = load_vocabulary(&handle)?;
    let word_lower = word.to_lowercase();
    Ok(vocab.entries.iter().any(|e| e.word.to_lowercase() == word_lower))
}

#[tauri::command(rename_all = "camelCase")]
fn export_vocabulary_markdown(handle: tauri::AppHandle) -> Result<String, String> {
    let vocab = load_vocabulary(&handle)?;

    let mut markdown = String::from("# My Vocabulary\n\n");
    markdown.push_str(&format!("Total words: {}\n\n", vocab.entries.len()));
    markdown.push_str("---\n\n");

    for entry in vocab.entries {
        markdown.push_str(&format!("## {}\n\n", entry.word));

        if let Some(phonetic) = &entry.phonetic {
            markdown.push_str(&format!("**Pronunciation:** {}\n\n", phonetic));
        }

        for def in &entry.definitions {
            if def.pos.is_empty() {
                markdown.push_str(&format!("- {}\n", def.meanings));
            } else {
                markdown.push_str(&format!("- **{}** {}\n", def.pos, def.meanings));
            }
        }

        markdown.push_str(&format!("\n*Added: {}*\n\n", entry.added_at.format("%Y-%m-%d %H:%M")));
        markdown.push_str("---\n\n");
    }

    Ok(markdown)
}

// Recent books management
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecentBook {
    id: String,
    file_path: String,
    file_name: String,
    file_type: String,
    title: String,
    author: Option<String>,
    cover_image: Option<String>,
    total_pages: u32,
    last_page: u32,
    progress: f32,
    last_opened_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecentBooksData {
    books: Vec<RecentBook>,
}

fn recent_books_file_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(handle)?.join("recent_books.json"))
}

fn load_recent_books(handle: &tauri::AppHandle) -> Result<RecentBooksData, String> {
    let path = recent_books_file_path(handle)?;
    if !path.exists() {
        return Ok(RecentBooksData { books: Vec::new() });
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn save_recent_books(handle: &tauri::AppHandle, data: &RecentBooksData) -> Result<(), String> {
    let path = recent_books_file_path(handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn get_recent_books(handle: tauri::AppHandle) -> Result<Vec<RecentBook>, String> {
    let data = load_recent_books(&handle)?;
    let mut books = data.books;
    books.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    Ok(books.into_iter().take(50).collect())
}

#[tauri::command(rename_all = "camelCase")]
fn add_recent_book(
    handle: tauri::AppHandle,
    id: String,
    file_path: String,
    file_name: String,
    file_type: String,
    title: String,
    author: Option<String>,
    cover_image: Option<String>,
    total_pages: u32,
) -> Result<(), String> {
    let mut data = load_recent_books(&handle)?;

    // Remove existing entry with same id OR same file_path (to prevent duplicates)
    data.books.retain(|b| b.id != id && b.file_path != file_path);

    // Add new entry
    data.books.push(RecentBook {
        id,
        file_path,
        file_name,
        file_type,
        title,
        author,
        cover_image,
        total_pages,
        last_page: 1,
        progress: 0.0,
        last_opened_at: Utc::now(),
    });

    // Keep only last 50 books
    data.books.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    data.books.truncate(50);

    save_recent_books(&handle, &data)
}

#[tauri::command(rename_all = "camelCase")]
fn update_book_progress(
    handle: tauri::AppHandle,
    id: String,
    last_page: u32,
    progress: f32,
) -> Result<(), String> {
    let mut data = load_recent_books(&handle)?;

    if let Some(book) = data.books.iter_mut().find(|b| b.id == id) {
        book.last_page = last_page;
        book.progress = progress;
        book.last_opened_at = Utc::now();
    }

    save_recent_books(&handle, &data)
}

#[tauri::command(rename_all = "camelCase")]
fn remove_recent_book(handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut data = load_recent_books(&handle)?;
    data.books.retain(|b| b.id != id);
    save_recent_books(&handle, &data)
}

// Chat with context command
#[tauri::command(rename_all = "camelCase")]
async fn chat_with_context(
    handle: tauri::AppHandle,
    model: String,
    context: String,
    question: String,
) -> Result<String, String> {
    let api_key = load_openrouter_key(&handle)?;

    let system_prompt = "You are a helpful reading assistant. Answer questions about the provided text context clearly and concisely. If the answer cannot be found in the context, say so.";

    let user_prompt = format!(
        "Context from the document:\n\n{}\n\n---\n\nQuestion: {}",
        context, question
    );

    let content = request_openrouter(&api_key, &model, 0.3, system_prompt, &user_prompt).await?;
    Ok(content)
}

fn extract_json_object(content: &str) -> String {
    let trimmed = content.trim();

    // If it starts with {, it's already JSON
    if trimmed.starts_with('{') {
        return trimmed.to_string();
    }

    // Try to extract from markdown code block
    if let Some(start) = trimmed.find("```json") {
        if let Some(end) = trimmed[start..].find("```\n").or_else(|| trimmed[start..].rfind("```")) {
            let json_start = start + 7;
            let json_end = start + end;
            if json_start < json_end {
                return trimmed[json_start..json_end].trim().to_string();
            }
        }
    }

    // Try to find JSON object in the content
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if start < end {
                return trimmed[start..=end].to_string();
            }
        }
    }

    trimmed.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_pdf_file,
            openrouter_translate,
            openrouter_word_lookup,
            save_openrouter_key,
            get_openrouter_key_info,
            test_openrouter_key,
            add_vocabulary_word,
            remove_vocabulary_word,
            get_vocabulary,
            is_word_in_vocabulary,
            export_vocabulary_markdown,
            get_recent_books,
            add_recent_book,
            update_book_progress,
            remove_recent_book,
            chat_with_context
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
