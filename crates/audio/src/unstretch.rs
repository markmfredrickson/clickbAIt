use anyhow::{Context, Result};
use serde::Serialize;

use crate::analyze::{decode_audio, detect_onsets};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnstretchResult {
    pub detected_bpm: f64,
    pub recording_bpm: f64,
    pub is_variable_tempo: bool,
    pub tempo_map: Vec<TempoPoint>,
    pub stats: TempoStats,
    pub beat_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoPoint {
    pub time: f64,
    pub bpm: f64,
    pub stretch_factor: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoStats {
    pub mean_bpm: f64,
    pub median_bpm: f64,
    pub min_bpm: f64,
    pub max_bpm: f64,
    pub std_dev: f64,
    pub cv: f64,
    pub range_pct: f64,
}

/// Analyze beat positions to detect tempo warping.
pub fn analyze_beats(beats: &[f64]) -> Result<UnstretchResult> {
    anyhow::ensure!(beats.len() >= 3, "Need at least 3 beats for tempo analysis");

    let ibis: Vec<f64> = beats.windows(2).map(|w| w[1] - w[0]).collect();

    // Adaptive filter: keep IBIs within ±50% of median
    let mut sorted_ibis = ibis.clone();
    sorted_ibis.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let rough_median = sorted_ibis[sorted_ibis.len() / 2];
    let lo = rough_median * 0.5;
    let hi = rough_median * 1.5;

    let valid_ibis: Vec<f64> = ibis.iter().copied().filter(|&ibi| ibi >= lo && ibi <= hi).collect();
    anyhow::ensure!(valid_ibis.len() >= 2, "Not enough valid inter-beat intervals");

    let bpms: Vec<f64> = valid_ibis.iter().map(|&ibi| 60.0 / ibi).collect();
    let stats = compute_stats(&bpms);

    // CV > 2% suggests intentional tempo variation
    let is_variable_tempo = stats.cv > 0.02;

    let recording_bpm = find_recording_bpm(&bpms, stats.median_bpm);

    // Build tempo map
    let mut tempo_map = Vec::new();
    for i in 0..beats.len() - 1 {
        let ibi = beats[i + 1] - beats[i];
        if ibi < lo || ibi > hi {
            continue;
        }
        let inst_bpm = 60.0 / ibi;
        tempo_map.push(TempoPoint {
            time: beats[i],
            bpm: inst_bpm,
            stretch_factor: recording_bpm / inst_bpm,
        });
    }

    Ok(UnstretchResult {
        detected_bpm: stats.median_bpm,
        recording_bpm,
        is_variable_tempo,
        tempo_map,
        stats,
        beat_count: beats.len(),
    })
}

fn find_recording_bpm(bpms: &[f64], median: f64) -> f64 {
    let lo = median * 0.8;
    let hi = median * 1.2;
    let bin_width = 0.5;
    let n_bins = ((hi - lo) / bin_width).ceil() as usize;

    let mut histogram = vec![0u32; n_bins];
    for &bpm in bpms {
        if bpm >= lo && bpm < hi {
            let bin = ((bpm - lo) / bin_width) as usize;
            if bin < n_bins {
                histogram[bin] += 1;
            }
        }
    }

    let peak_bin = histogram
        .iter()
        .enumerate()
        .max_by_key(|(_, &count)| count)
        .map(|(i, _)| i)
        .unwrap_or(0);

    let peak_bpm = lo + (peak_bin as f64 + 0.5) * bin_width;

    // Snap to nearest integer if close
    let nearest_int = peak_bpm.round();
    if (peak_bpm - nearest_int).abs() < 0.5 {
        nearest_int
    } else {
        peak_bpm
    }
}

fn compute_stats(bpms: &[f64]) -> TempoStats {
    let n = bpms.len() as f64;
    let mean = bpms.iter().sum::<f64>() / n;

    let mut sorted = bpms.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = if sorted.len() % 2 == 0 {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
    } else {
        sorted[sorted.len() / 2]
    };

    let min = sorted[0];
    let max = sorted[sorted.len() - 1];
    let variance = bpms.iter().map(|&b| (b - mean).powi(2)).sum::<f64>() / n;
    let std_dev = variance.sqrt();
    let cv = std_dev / mean;
    let range_pct = (max - min) / mean * 100.0;

    TempoStats { mean_bpm: mean, median_bpm: median, min_bpm: min, max_bpm: max, std_dev, cv, range_pct }
}

pub fn run(file: &str) -> Result<()> {
    eprintln!("Decoding {}...", file);
    let (samples, sample_rate) = decode_audio(file)?;
    eprintln!(
        "Decoded: {} samples, {}Hz, {:.1}s",
        samples.len(),
        sample_rate,
        samples.len() as f64 / sample_rate as f64
    );

    eprintln!("Detecting onsets...");
    let onsets = detect_onsets(&samples, sample_rate);
    let beat_times: Vec<f64> = onsets.iter().map(|o| o.time).collect();
    eprintln!("Found {} onsets", beat_times.len());

    let unstretch = analyze_beats(&beat_times).context("Unstretch analysis failed")?;

    eprintln!();
    eprintln!("=== Unstretch Analysis ===");
    eprintln!("Detected BPM:  {:.1}", unstretch.detected_bpm);
    eprintln!("Recording BPM: {:.0} (estimated constant tempo)", unstretch.recording_bpm);
    eprintln!(
        "Variable tempo: {}",
        if unstretch.is_variable_tempo { "YES" } else { "no" }
    );
    eprintln!(
        "BPM range:     {:.1} - {:.1} ({:.1}% spread)",
        unstretch.stats.min_bpm, unstretch.stats.max_bpm, unstretch.stats.range_pct
    );
    eprintln!(
        "Std deviation: {:.2} BPM (CV: {:.1}%)",
        unstretch.stats.std_dev, unstretch.stats.cv * 100.0
    );

    if unstretch.is_variable_tempo {
        eprintln!();
        eprintln!(
            "This track appears to have been recorded at {:.0} BPM",
            unstretch.recording_bpm
        );
        eprintln!("and then tempo-warped. To unstretch, resample each beat");
        eprintln!("segment by its stretch_factor to flatten to constant tempo.");
    }

    println!("{}", serde_json::to_string_pretty(&unstretch)?);
    Ok(())
}
