//! Split a vocal stem into voiced chunks separated by silence.
//!
//! Step 1 of the chunked-alignment pipeline: cut the empty runway (silent /
//! instrumental regions) out of the vocal stem so downstream Whisper sees only
//! sung audio — it can't hallucinate or spread words into a long intro, and each
//! chunk is a bounded window for wav2vec2 to force-align within. The index maps
//! every chunk back to its offset in the source, so timestamps can be restored.

use crate::analyze::decode_audio;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct ChunkEntry {
    index: usize,
    file: String,
    /// Offset of this chunk in the SOURCE file (add back to chunk-local times).
    start_ms: u64,
    end_ms: u64,
}

#[derive(Serialize)]
struct ChunkIndex {
    source: String,
    sample_rate: u32,
    chunks: Vec<ChunkEntry>,
}

pub struct ChunkOpts {
    pub out_dir: Option<String>,
    /// A silence gap at least this long splits two chunks (shorter gaps are kept
    /// inside a chunk — a rest mid-phrase shouldn't fragment it).
    pub min_silence_ms: u64,
    /// Drop a voiced run shorter than this (a stray click / breath, not a phrase).
    pub min_chunk_ms: u64,
    /// Keep this much audio on each side of a chunk so attacks/tails aren't clipped.
    pub pad_ms: u64,
    /// A frame is "voiced" when its RMS is at least this fraction of the loudest
    /// frame. Above stem bleed but below real singing.
    pub threshold: f32,
}

impl Default for ChunkOpts {
    fn default() -> Self {
        ChunkOpts { out_dir: None, min_silence_ms: 400, min_chunk_ms: 300, pad_ms: 200, threshold: 0.08 }
    }
}

/// Frame the samples into ~20ms RMS frames.
fn rms_frames(samples: &[f32], win: usize) -> Vec<f32> {
    let mut rms = Vec::new();
    let mut i = 0;
    while i < samples.len() {
        let end = (i + win).min(samples.len());
        let mut sum = 0.0f64;
        for &s in &samples[i..end] {
            sum += (s as f64) * (s as f64);
        }
        rms.push((sum / (end - i) as f64).sqrt() as f32);
        i += win;
    }
    rms
}

/// Voiced [start_frame, end_frame) segments: runs of voiced frames merged across
/// silence gaps shorter than `min_sil_frames`. Pure algorithm — unit-tested below.
fn voiced_segments(voiced: &[bool], min_sil_frames: usize) -> Vec<(usize, usize)> {
    let mut segs: Vec<(usize, usize)> = Vec::new();
    let mut start: Option<usize> = None;
    let mut last_voiced: usize = 0;
    for (f, &v) in voiced.iter().enumerate() {
        if v {
            if start.is_none() {
                start = Some(f);
            } else if f - last_voiced - 1 >= min_sil_frames {
                // The gap since the previous voiced frame is a real split.
                segs.push((start.unwrap(), last_voiced + 1));
                start = Some(f);
            }
            last_voiced = f;
        }
    }
    if let Some(s) = start {
        segs.push((s, last_voiced + 1));
    }
    segs
}

/// Write mono f32 samples to a 16-bit WAV.
fn write_mono_wav(path: &Path, samples: &[f32], sample_rate: u32) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .with_context(|| format!("Failed to create WAV file: {}", path.display()))?;
    for &s in samples {
        writer.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
    }
    writer.finalize()?;
    Ok(())
}

pub fn run(file: &str, opts: ChunkOpts) -> Result<()> {
    let (samples, sr) = decode_audio(file)?;
    if samples.is_empty() {
        bail!("audio is empty");
    }
    let win = (sr as usize / 50).max(1); // ~20ms
    let rms = rms_frames(&samples, win);
    let peak = rms.iter().cloned().fold(0.0f32, f32::max);
    if peak <= 0.0 {
        bail!("audio is silent throughout");
    }
    let thresh = (peak * opts.threshold).max(1e-4);
    let voiced: Vec<bool> = rms.iter().map(|&r| r >= thresh).collect();

    let ms_to_frames = |ms: u64| ((ms as usize * sr as usize) / 1000) / win;
    let min_sil_frames = ms_to_frames(opts.min_silence_ms).max(1);
    let min_chunk_samples = (opts.min_chunk_ms as usize * sr as usize) / 1000;
    let pad = (opts.pad_ms as usize * sr as usize) / 1000;

    let out_dir = opts
        .out_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(format!("{file}.chunks")));
    fs::create_dir_all(&out_dir)
        .with_context(|| format!("Failed to create chunk dir: {}", out_dir.display()))?;

    let mut entries = Vec::new();
    let mut idx = 0usize;
    for (sf, ef) in voiced_segments(&voiced, min_sil_frames) {
        // Frame range -> sample range, padded and clamped to the file.
        let raw_start = sf * win;
        let raw_end = (ef * win).min(samples.len());
        let start = raw_start.saturating_sub(pad);
        let end = (raw_end + pad).min(samples.len());
        if end - start < min_chunk_samples {
            continue; // too short to be a phrase
        }
        let name = format!("{idx:03}.wav");
        write_mono_wav(&out_dir.join(&name), &samples[start..end], sr)?;
        entries.push(ChunkEntry {
            index: idx,
            file: name,
            start_ms: (start as f64 / sr as f64 * 1000.0) as u64,
            end_ms: (end as f64 / sr as f64 * 1000.0) as u64,
        });
        idx += 1;
    }

    let total_s = samples.len() as f64 / sr as f64;
    let voiced_s: f64 = entries.iter().map(|e| (e.end_ms - e.start_ms) as f64 / 1000.0).sum();
    eprintln!(
        "chunked {:.1}s into {} chunk(s), {:.1}s voiced ({:.0}% dropped as silence/instrumental)",
        total_s,
        entries.len(),
        voiced_s,
        (1.0 - voiced_s / total_s) * 100.0
    );

    let index = ChunkIndex { source: file.to_string(), sample_rate: sr, chunks: entries };
    let json = serde_json::to_string_pretty(&index)?;
    fs::write(out_dir.join("index.json"), &json)?;
    println!("{json}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_short_gaps_and_splits_long_ones() {
        // voiced (V) with a 1-frame gap (kept) then a 4-frame gap (split).
        // frames: V V _ V V _ _ _ _ V V
        let v = [true, true, false, true, true, false, false, false, false, true, true];
        let segs = voiced_segments(&v, 3); // gaps >= 3 frames split
        assert_eq!(segs, vec![(0, 5), (9, 11)]);
    }

    #[test]
    fn single_run() {
        let v = [false, true, true, true, false];
        assert_eq!(voiced_segments(&v, 2), vec![(1, 4)]);
    }

    #[test]
    fn empty_when_silent() {
        let v = [false, false, false];
        assert_eq!(voiced_segments(&v, 2), Vec::<(usize, usize)>::new());
    }
}
