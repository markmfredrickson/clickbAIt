use anyhow::{Context, Result};
use std::path::PathBuf;
use reqwest::blocking as http;

const WHISPER_MODEL: &str = "base.en";
const WHISPER_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

const PIPER_VOICE: &str = "en_US-lessac-medium";
const PIPER_ONNX_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx";
const PIPER_JSON_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json";

pub fn run() -> Result<()> {
    eprintln!("=== clickbAIt setup ===\n");

    setup_whisper()?;
    setup_piper()?;
    setup_demucs()?;

    eprintln!("\n=== Setup complete ===");
    eprintln!("Run `clickbait-audio split <audio-file>` to get started.");
    Ok(())
}

fn whisper_model_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(PathBuf::from(home)
        .join(".cache/clickbait/models")
        .join(format!("ggml-{WHISPER_MODEL}.bin")))
}

fn setup_whisper() -> Result<()> {
    let path = whisper_model_path()?;

    if path.exists() {
        eprintln!("[whisper] Already downloaded: {}", path.display());
        return Ok(());
    }

    eprintln!("[whisper] Downloading {WHISPER_MODEL} model (~150 MB)...");
    std::fs::create_dir_all(path.parent().unwrap())?;
    download(WHISPER_URL, &path)?;
    eprintln!("[whisper] Saved to {}", path.display());
    Ok(())
}

fn setup_piper() -> Result<()> {
    let model_dir = crate::speak::model_dir()?;
    let onnx = model_dir.join(format!("{PIPER_VOICE}.onnx"));
    let json = model_dir.join(format!("{PIPER_VOICE}.onnx.json"));

    if onnx.exists() && json.exists() {
        eprintln!("[piper] Already downloaded: {PIPER_VOICE}");
        return Ok(());
    }

    eprintln!("[piper] Downloading {PIPER_VOICE} voice model (~65 MB)...");
    std::fs::create_dir_all(&model_dir)?;

    if !onnx.exists() {
        download(PIPER_ONNX_URL, &onnx)?;
    }
    if !json.exists() {
        download(PIPER_JSON_URL, &json)?;
    }
    eprintln!("[piper] Saved to {}", model_dir.display());
    Ok(())
}

fn setup_demucs() -> Result<()> {
    use demucs_core::provider::fs::FsProvider;
    use demucs_core::provider::ModelProvider;
    use demucs_core::model::metadata::HTDEMUCS_6S;

    let provider = FsProvider::new().context("Failed to initialize demucs cache")?;
    let info = HTDEMUCS_6S;

    if provider.is_cached(&info) {
        eprintln!("[demucs] Already downloaded: {}", info.label);
        return Ok(());
    }

    eprintln!("[demucs] Downloading 6-stem model ({} MB)...", info.size_mb);
    let url = demucs_core::model::metadata::download_url(&info);
    let bytes = http::get(&url)
        .with_context(|| format!("Failed to download demucs model from {url}"))?
        .bytes()
        .context("Failed to read demucs model response")?;
    provider.cache_model(&info, &bytes).context("Failed to cache demucs model")?;
    eprintln!("[demucs] Saved.");
    Ok(())
}

fn download(url: &str, dest: &PathBuf) -> Result<()> {
    let bytes = http::get(url)
        .with_context(|| format!("Failed to download {url}"))?
        .bytes()
        .context("Failed to read response body")?;
    std::fs::write(dest, &bytes)
        .with_context(|| format!("Failed to write {}", dest.display()))?;
    Ok(())
}
