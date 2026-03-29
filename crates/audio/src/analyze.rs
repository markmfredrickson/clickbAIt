use anyhow::{Context, Result};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::f64::consts::PI;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Onset {
    pub time: f64,
    pub strength: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResult {
    pub bpm: f64,
    pub onsets: Vec<Onset>,
    pub duration: f64,
    pub sample_rate: u32,
}

/// Decode an audio file to mono f32 samples using symphonia.
pub fn decode_audio(path: &str) -> Result<(Vec<f32>, u32)> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open audio file: {path}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .with_context(|| format!("Failed to probe audio format: {path}"))?;

    let mut format = probed.format;

    let track = format.default_track().context("No audio tracks found")?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .context("No sample rate in codec params")?;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(2);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("Failed to create audio decoder")?;

    let mut samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => return Err(e.into()),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = decoder.decode(&packet)?;
        let spec = *decoded.spec();
        let num_frames = decoded.frames();

        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);

        let interleaved = sample_buf.samples();

        if channels == 1 {
            samples.extend_from_slice(interleaved);
        } else {
            for chunk in interleaved.chunks(channels) {
                let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                samples.push(mono);
            }
        }
    }

    Ok((samples, sample_rate))
}

/// Compute the Hann window of a given size.
fn hann_window(size: usize) -> Vec<f64> {
    (0..size)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f64 / size as f64).cos()))
        .collect()
}

/// Compute spectral flux onset detection function.
/// Returns (onset_times, onset_strengths) — one value per STFT hop.
fn spectral_flux(samples: &[f32], sample_rate: u32) -> (Vec<f64>, Vec<f64>) {
    let fft_size = 2048_usize;
    let hop_size = 512_usize;
    let sr = sample_rate as f64;

    let window = hann_window(fft_size);

    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);

    let n_frames = (samples.len().saturating_sub(fft_size)) / hop_size + 1;
    let n_bins = fft_size / 2 + 1;

    // Compute magnitude spectra for all frames
    let mut magnitudes: Vec<Vec<f64>> = Vec::with_capacity(n_frames);
    let mut fft_buf = vec![Complex::new(0.0_f64, 0.0); fft_size];

    for i in 0..n_frames {
        let start = i * hop_size;
        for j in 0..fft_size {
            let sample = if start + j < samples.len() {
                samples[start + j] as f64
            } else {
                0.0
            };
            fft_buf[j] = Complex::new(sample * window[j], 0.0);
        }

        fft.process(&mut fft_buf);

        let mag: Vec<f64> = fft_buf[..n_bins]
            .iter()
            .map(|c| c.norm())
            .collect();
        magnitudes.push(mag);
    }

    // Compute spectral flux: sum of positive magnitude differences
    let mut flux = vec![0.0_f64; n_frames];
    for i in 1..n_frames {
        let mut sum = 0.0;
        for k in 0..n_bins {
            let diff = magnitudes[i][k] - magnitudes[i - 1][k];
            if diff > 0.0 {
                sum += diff;
            }
        }
        flux[i] = sum;
    }

    // Normalize flux to 0-1 range
    let max_flux = flux.iter().cloned().fold(0.0_f64, f64::max);
    if max_flux > 0.0 {
        for v in &mut flux {
            *v /= max_flux;
        }
    }

    // Generate time axis
    let times: Vec<f64> = (0..n_frames)
        .map(|i| i as f64 * hop_size as f64 / sr)
        .collect();

    (times, flux)
}

/// Detect onsets from spectral flux using adaptive thresholding.
/// Returns onset times and their strengths (0-1).
pub fn detect_onsets(samples: &[f32], sample_rate: u32) -> Vec<Onset> {
    let (times, flux) = spectral_flux(samples, sample_rate);
    let hop_size = 512_usize;
    let sr = sample_rate as f64;

    // Adaptive threshold: running median in a window + multiplier
    let window = 15; // frames of lookaround (~175ms at 512 hop / 44100)
    let threshold_multiplier = 1.4;
    let min_threshold = 0.05;

    // Minimum gap between onsets: 100ms
    let min_onset_gap = (0.10 * sr / hop_size as f64) as usize;

    let mut onsets = Vec::new();
    let mut last_onset: Option<usize> = None;

    for i in window..flux.len().saturating_sub(window) {
        // Running median as adaptive threshold
        let mut local: Vec<f64> = flux[i.saturating_sub(window)..=(i + window).min(flux.len() - 1)].to_vec();
        local.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = local[local.len() / 2];
        let threshold = (median * threshold_multiplier).max(min_threshold);

        if flux[i] <= threshold {
            continue;
        }

        // Must be a local maximum (peak)
        if i > 0 && i < flux.len() - 1 && (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) {
            continue;
        }

        // Enforce minimum gap
        if let Some(last) = last_onset {
            if i - last < min_onset_gap {
                // Keep the stronger one
                if !onsets.is_empty() && flux[i] > onsets.last().map(|o: &Onset| o.strength).unwrap_or(0.0) {
                    onsets.pop();
                    last_onset = Some(i);
                } else {
                    continue;
                }
            }
        }

        onsets.push(Onset {
            time: times[i],
            strength: flux[i],
        });
        last_onset = Some(i);
    }

    onsets
}

/// Estimate BPM from onset times using median inter-onset interval.
pub fn estimate_bpm(onsets: &[Onset]) -> f64 {
    if onsets.len() < 3 {
        return 0.0;
    }

    let ibis: Vec<f64> = onsets.windows(2).map(|w| w[1].time - w[0].time).collect();

    let mut sorted = ibis.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_ibi = sorted[sorted.len() / 2];

    60.0 / median_ibi
}

pub fn run(file: &str) -> Result<()> {
    eprintln!("Decoding {}...", file);
    let (samples, sample_rate) = decode_audio(file)?;
    let duration = samples.len() as f64 / sample_rate as f64;
    eprintln!(
        "Decoded: {} samples, {}Hz, {:.1}s",
        samples.len(),
        sample_rate,
        duration,
    );

    eprintln!("Detecting onsets (spectral flux)...");
    let onsets = detect_onsets(&samples, sample_rate);
    let bpm = estimate_bpm(&onsets);

    eprintln!("Found {} onsets, estimated {:.1} BPM", onsets.len(), bpm);

    let output = AnalyzeResult {
        bpm,
        onsets,
        duration,
        sample_rate,
    };

    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
