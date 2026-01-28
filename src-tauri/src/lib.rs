use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

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

fn build_system_prompt() -> String {
    [
        "You are a translation engine.",
        "Translate into the specified target language.",
        "Output STRICT JSON ONLY.",
        "No markdown, no explanations, no extra text.",
    ]
    .join(" ")
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
    fs::read(path).map_err(|e| e.to_string())
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
    let parsed: Vec<TranslationResult> = serde_json::from_str(content).map_err(|e| e.to_string())?;
    Ok(parsed)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_pdf_file, openrouter_translate])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
