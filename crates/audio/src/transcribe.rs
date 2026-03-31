use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub words: Vec<Word>,
}

/// Resolve a model argument to a file path.
///
/// - If `model` is an existing file path, use it directly.
/// - Otherwise treat it as a short name (e.g. "base.en") and look in
///   `~/.cache/clickbait/models/ggml-{name}.bin`.
fn resolve_model(model: &str) -> Result<PathBuf> {
    let p = Path::new(model);
    if p.exists() {
        return Ok(p.to_path_buf());
    }

    let home = std::env::var("HOME").context("HOME not set")?;
    let cache_path = PathBuf::from(home)
        .join(".cache/clickbait/models")
        .join(format!("ggml-{model}.bin"));

    if cache_path.exists() {
        return Ok(cache_path);
    }

    bail!(
        "Model not found: tried '{model}' and '{}'\n\
         Download a model from https://huggingface.co/ggerganov/whisper.cpp/tree/main\n\
         Place it at: {}",
        cache_path.display(),
        cache_path.display(),
    );
}

/// Decode audio to 16 kHz mono f32 PCM via ffmpeg.
fn decode_audio_f32(file: &str) -> Result<Vec<f32>> {
    let output = Command::new("ffmpeg")
        .args(["-i", file, "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"])
        .arg("-loglevel")
        .arg("error")
        .output()
        .context(
            "ffmpeg not found on PATH. Install: https://ffmpeg.org/download.html",
        )?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("ffmpeg failed: {stderr}");
    }

    let bytes = &output.stdout;
    if bytes.len() % 4 != 0 {
        bail!("ffmpeg output is not aligned to 4-byte f32 samples");
    }

    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    Ok(samples)
}

fn sidecar_path(file: &str) -> PathBuf {
    let p = Path::new(file);
    let stem = p.file_stem().unwrap_or_default().to_str().unwrap_or_default();
    p.with_file_name(format!("{stem}.words.json"))
}

pub fn run(file: &str, model: &str) -> Result<()> {
    let sidecar = sidecar_path(file);

    if sidecar.exists() {
        eprintln!("Using cached transcription: {}", sidecar.display());
        print!("{}", fs::read_to_string(&sidecar)?);
        return Ok(());
    }

    eprintln!("Transcribing {file} with model {model}...");

    // 1. Resolve model path
    let model_path = resolve_model(model)?;
    eprintln!("Using model: {}", model_path.display());

    // 2. Decode audio to 16 kHz mono f32
    eprintln!("Decoding audio via ffmpeg...");
    let samples = decode_audio_f32(file)?;
    eprintln!("Got {} samples ({:.1}s)", samples.len(), samples.len() as f64 / 16000.0);

    // 3. Load whisper model
    let ctx = WhisperContext::new_with_params(
        &model_path,
        WhisperContextParameters::default(),
    )
    .context("Failed to load whisper model")?;

    let mut state = ctx.create_state().context("Failed to create whisper state")?;

    // 4. Configure and run inference
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_token_timestamps(true);
    params.set_split_on_word(true);
    params.set_max_len(1); // split into individual words/short segments
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);

    eprintln!("Running whisper inference...");
    state.full(params, &samples).context("Whisper inference failed")?;

    // 5. Extract words from segments
    let mut words = Vec::new();

    for segment in state.as_iter() {
        let text = segment.to_str_lossy().unwrap_or_default().trim().to_string();
        if text.is_empty() || text.starts_with('[') {
            continue;
        }

        // Timestamps are in centiseconds (10ms units)
        let start_ms = (segment.start_timestamp() * 10) as u64;
        let end_ms = (segment.end_timestamp() * 10) as u64;

        // Get confidence from first token's probability
        let confidence = if segment.n_tokens() > 0 {
            segment.get_token(0).map_or(0.0, |t| t.token_probability() as f64)
        } else {
            0.0
        };

        words.push(Word {
            text,
            start_ms,
            end_ms,
            confidence,
        });
    }

    eprintln!("Transcribed {} words", words.len());

    // 6. Write sidecar and print to stdout
    let result = TranscribeResult { words };
    let json = serde_json::to_string_pretty(&result)?;
    fs::write(&sidecar, &json)
        .with_context(|| format!("Failed to write sidecar: {}", sidecar.display()))?;
    eprintln!("Saved: {}", sidecar.display());
    println!("{json}");

    Ok(())
}
