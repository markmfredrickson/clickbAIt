use anyhow::{Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};
use piper_rs::Piper;
use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction, Resampler};
use std::path::Path;

/// Target sample rate for all output WAVs — matches REAPER project and stems.
const TARGET_SAMPLE_RATE: u32 = 44100;

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

    let (out_samples, out_rate) = if sample_rate != TARGET_SAMPLE_RATE {
        eprintln!("Resampling {} Hz → {} Hz", sample_rate, TARGET_SAMPLE_RATE);
        (resample_sinc(&samples, sample_rate, TARGET_SAMPLE_RATE)?, TARGET_SAMPLE_RATE)
    } else {
        (samples, sample_rate)
    };

    let trimmed = trim_silence(&out_samples, out_rate);
    if trimmed.len() != out_samples.len() {
        let removed_ms = ((out_samples.len() - trimmed.len()) as f32 / out_rate as f32) * 1000.0;
        eprintln!("Trimmed {:.0}ms of silence", removed_ms);
    }

    write_wav(output, &trimmed, out_rate)?;
    eprintln!("Written: {output}");
    Ok(())
}

/// Trim leading and trailing silence from a PCM buffer.
///
/// Piper emits a short lead-in and tail before/after the spoken content.
/// For cue WAVs placed on a beat grid this makes the audible "word" land
/// late. Scan for the first and last sample with |amplitude| > threshold
/// and return that window, keeping a tiny pre-roll so there's no click.
fn trim_silence(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    // ~-50 dB from full scale. Piper's silence is effectively zero but
    // resampling can introduce tiny numerical noise, so use a small floor.
    const THRESHOLD: f32 = 0.003;
    // Keep ~2ms of pre-roll so the attack isn't clipped.
    let pre_roll = (sample_rate as f32 * 0.002) as usize;

    let first = samples.iter().position(|s| s.abs() > THRESHOLD);
    let last = samples.iter().rposition(|s| s.abs() > THRESHOLD);

    match (first, last) {
        (Some(f), Some(l)) => {
            let start = f.saturating_sub(pre_roll);
            // Add a few ms of tail padding so the release isn't clipped either.
            let end = (l + pre_roll).min(samples.len());
            samples[start..end].to_vec()
        }
        // All silence — shouldn't happen with a real TTS output, but fall back
        // to returning the input unchanged so we never write an empty WAV.
        _ => samples.to_vec(),
    }
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

/// High-quality sinc resampling via rubato.
fn resample_sinc(samples: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>> {
    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = to_rate as f64 / from_rate as f64;
    let chunk_size = 1024;

    let mut resampler = SincFixedIn::<f64>::new(
        ratio,
        2.0,          // max relative ratio (fixed rate, so just headroom)
        params,
        chunk_size,
        1,            // mono
    ).map_err(|e| anyhow::anyhow!("Failed to create resampler: {e}"))?;

    // Convert f32 → f64 for rubato
    let input_f64: Vec<f64> = samples.iter().map(|&s| s as f64).collect();

    let mut output = Vec::new();
    let mut pos = 0;

    while pos < input_f64.len() {
        let end = (pos + chunk_size).min(input_f64.len());
        let mut chunk = input_f64[pos..end].to_vec();
        // Pad last chunk if needed
        if chunk.len() < chunk_size {
            chunk.resize(chunk_size, 0.0);
        }
        let result = resampler.process(&[chunk], None)
            .map_err(|e| anyhow::anyhow!("Resample failed: {e}"))?;
        output.extend_from_slice(&result[0]);
        pos += chunk_size;
    }

    // Trim to expected length
    let expected_len = (samples.len() as f64 * ratio).ceil() as usize;
    output.truncate(expected_len);

    Ok(output.iter().map(|&s| s as f32).collect())
}

/// Resolve the directory where voice models live.
/// Checks $CLICKBAIT_MODELS, then ~/.cache/clickbait/voices/
pub fn model_dir() -> Result<std::path::PathBuf> {
    if let Ok(dir) = std::env::var("CLICKBAIT_MODELS") {
        return Ok(Path::new(&dir).to_path_buf());
    }
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(Path::new(&home).join(".cache/clickbait/voices"))
}
