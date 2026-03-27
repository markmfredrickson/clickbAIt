use anyhow::Result;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResult {
    pub bpm: u32,
    pub key: String,
    pub scale: String,
    pub key_strength: f64,
    pub beats: Vec<f64>,
    pub confidence: f64,
    pub duration: f64,
    pub sample_rate: u32,
}

pub fn run(file: &str) -> Result<()> {
    eprintln!("Analyzing {}...", file);

    // TODO: implement with essentia-rs
    // 1. Decode audio via ffmpeg to raw f32 PCM
    // 2. BeatTrackerMultiFeature → beat ticks + confidence
    // 3. Derive BPM from median inter-beat interval
    // 4. KeyExtractor → key + scale + strength

    anyhow::bail!("Not yet implemented. See crates/audio/src/analyze.rs")
}
