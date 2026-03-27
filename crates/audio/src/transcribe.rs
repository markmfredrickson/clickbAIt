use anyhow::Result;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub words: Vec<Word>,
}

pub fn run(file: &str, model: &str) -> Result<()> {
    eprintln!("Transcribing {} with model {}...", file, model);

    // TODO: implement with whisper-rs
    // 1. Decode audio via ffmpeg to 16kHz mono f32
    // 2. Load whisper model
    // 3. Run with word-level timestamps
    // 4. Output words with timing + confidence

    anyhow::bail!("Not yet implemented. See crates/audio/src/transcribe.rs")
}
