use anyhow::{Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};
use piper_rs::Piper;
use std::path::Path;

pub fn run(text: &str, output: &str, voice: &str) -> Result<()> {
    let model_dir = model_dir()?;
    let config_path = model_dir.join(format!("{voice}.onnx.json"));
    let onnx_path = model_dir.join(format!("{voice}.onnx"));

    anyhow::ensure!(
        config_path.exists(),
        "Voice model not found: {}\nDownload from https://huggingface.co/rhasspy/piper-voices\n\
         Place {voice}.onnx and {voice}.onnx.json in {}",
        config_path.display(),
        model_dir.display(),
    );

    eprintln!("Loading voice model: {voice}");
    let mut piper = Piper::new(&onnx_path, &config_path)
        .map_err(|e| anyhow::anyhow!("Failed to load Piper model: {e}"))?;

    eprintln!("Synthesizing: \"{text}\"");
    let (samples, sample_rate) = piper
        .create(text, false, None, None, None, None)
        .map_err(|e| anyhow::anyhow!("Synthesis failed: {e}"))?;

    write_wav(output, &samples, sample_rate)?;
    eprintln!("Written: {output}");
    Ok(())
}

fn write_wav(path: &str, samples: &[f32], sample_rate: u32) -> Result<()> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer = WavWriter::create(path, spec)
        .with_context(|| format!("Failed to create WAV file: {path}"))?;
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        writer.write_sample((clamped * i16::MAX as f32) as i16)?;
    }
    writer.finalize()?;
    Ok(())
}

/// Resolve the directory where voice models live.
/// Checks $CLICKBAIT_MODELS, then ~/.local/share/clickbait/voices/
fn model_dir() -> Result<std::path::PathBuf> {
    if let Ok(dir) = std::env::var("CLICKBAIT_MODELS") {
        return Ok(Path::new(&dir).to_path_buf());
    }
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(Path::new(&home).join(".local/share/clickbait/voices"))
}
