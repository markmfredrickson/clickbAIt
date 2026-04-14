//! Beat activation functions — convert raw audio into a 1-D signal at a fixed
//! frame rate where high values indicate likely beat positions.
//!
//! These feed into the DBN beat tracker. Each function produces a Vec<f64>
//! at `fps` frames per second with values roughly in [0, 1].

use rustfft::{num_complex::Complex, FftPlanner};
use std::f64::consts::PI;

/// Compute a beat activation signal from RMS energy envelope.
///
/// Simple and effective for percussive sources (drum stems). Computes
/// short-term energy in a window, then takes the positive first derivative
/// (energy increase = onset). The result is normalized to [0, 1].
pub fn energy_activation(samples: &[f32], sample_rate: u32, fps: f64) -> Vec<f64> {
    let hop = (sample_rate as f64 / fps).round() as usize;
    let window_size = hop * 2; // overlap by 2x for smoothness
    let n_frames = samples.len() / hop;

    if n_frames < 2 {
        return Vec::new();
    }

    // Compute RMS energy per frame
    let mut energy = Vec::with_capacity(n_frames);
    for i in 0..n_frames {
        let center = i * hop;
        let start = center.saturating_sub(window_size / 2);
        let end = (center + window_size / 2).min(samples.len());
        let rms: f64 = samples[start..end]
            .iter()
            .map(|&s| (s as f64) * (s as f64))
            .sum::<f64>()
            / (end - start) as f64;
        energy.push(rms.sqrt());
    }

    // Half-wave rectified first derivative (positive energy changes only)
    let mut activation = vec![0.0; n_frames];
    for i in 1..n_frames {
        let diff = energy[i] - energy[i - 1];
        activation[i] = diff.max(0.0);
    }

    // Normalize to [0, 1]
    let max_val = activation.iter().cloned().fold(0.0_f64, f64::max);
    if max_val > 0.0 {
        for v in &mut activation {
            *v /= max_val;
        }
    }

    activation
}

/// Compute a beat activation signal from spectral flux.
///
/// Better for mixed audio where energy alone is ambiguous. Computes
/// half-wave rectified spectral flux, then resamples to the target fps.
pub fn spectral_flux_activation(samples: &[f32], sample_rate: u32, fps: f64) -> Vec<f64> {
    let fft_size = 2048_usize;
    let hop_size = 512_usize;
    let sr = sample_rate as f64;

    let window = hann_window(fft_size);

    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);

    let n_stft_frames = (samples.len().saturating_sub(fft_size)) / hop_size + 1;
    let n_bins = fft_size / 2 + 1;

    if n_stft_frames < 2 {
        return Vec::new();
    }

    // Compute magnitude spectra and spectral flux in one pass
    let mut prev_mag = vec![0.0_f64; n_bins];
    let mut fft_buf = vec![Complex::new(0.0_f64, 0.0); fft_size];
    let mut flux = Vec::with_capacity(n_stft_frames);

    for i in 0..n_stft_frames {
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

        let mut sum = 0.0;
        for k in 0..n_bins {
            let mag = fft_buf[k].norm();
            let diff = mag - prev_mag[k];
            if diff > 0.0 {
                sum += diff;
            }
            prev_mag[k] = mag;
        }
        flux.push(sum);
    }

    // Resample flux (at STFT rate) to target fps using linear interpolation
    let stft_fps = sr / hop_size as f64;
    let duration = samples.len() as f64 / sr;
    let n_out = (duration * fps).ceil() as usize;
    let mut activation = Vec::with_capacity(n_out);

    for i in 0..n_out {
        let t = i as f64 / fps;
        let stft_pos = t * stft_fps;
        let idx = stft_pos as usize;
        let frac = stft_pos - idx as f64;

        let val = if idx + 1 < flux.len() {
            flux[idx] * (1.0 - frac) + flux[idx + 1] * frac
        } else if idx < flux.len() {
            flux[idx]
        } else {
            0.0
        };
        activation.push(val);
    }

    // Normalize to [0, 1]
    let max_val = activation.iter().cloned().fold(0.0_f64, f64::max);
    if max_val > 0.0 {
        for v in &mut activation {
            *v /= max_val;
        }
    }

    activation
}

fn hann_window(size: usize) -> Vec<f64> {
    (0..size)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f64 / size as f64).cos()))
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Generate a synthetic drum-like signal: periodic transients with decay.
    fn make_drum_signal(bpm: f64, sample_rate: u32, duration_secs: f64) -> Vec<f32> {
        let n = (duration_secs * sample_rate as f64) as usize;
        let beat_interval = 60.0 / bpm * sample_rate as f64;
        let decay_samples = (0.02 * sample_rate as f64) as usize; // 20ms decay

        let mut signal = vec![0.0f32; n];
        let mut pos = 0.0_f64;
        while (pos as usize) < n {
            let start = pos as usize;
            for j in 0..decay_samples {
                let idx = start + j;
                if idx < n {
                    let envelope = (-5.0 * j as f64 / decay_samples as f64).exp();
                    signal[idx] = (envelope * 0.8) as f32;
                }
            }
            pos += beat_interval;
        }
        signal
    }

    #[test]
    fn energy_activation_length() {
        let sr = 44100;
        let fps = 100.0;
        let signal = vec![0.0f32; sr * 3]; // 3 seconds
        let act = energy_activation(&signal, sr as u32, fps);
        // Should have ~300 frames (3s * 100fps)
        assert!(act.len() >= 290 && act.len() <= 310,
            "expected ~300 frames, got {}", act.len());
    }

    #[test]
    fn energy_activation_peaks_on_beats() {
        let sr = 44100u32;
        let fps = 100.0;
        let bpm = 120.0;
        let signal = make_drum_signal(bpm, sr, 5.0);
        let act = energy_activation(&signal, sr, fps);

        // Find peaks (local maxima above 0.5)
        let mut peaks = Vec::new();
        for i in 1..act.len() - 1 {
            if act[i] > 0.3 && act[i] >= act[i - 1] && act[i] >= act[i + 1] {
                peaks.push(i as f64 / fps);
            }
        }

        // At 120 BPM, beats every 0.5s. Over 5s = ~10 beats.
        assert!(
            peaks.len() >= 8 && peaks.len() <= 14,
            "expected ~10 peaks at 120 BPM, got {}", peaks.len()
        );

        // Check spacing is roughly 0.5s
        if peaks.len() >= 2 {
            let ibis: Vec<f64> = peaks.windows(2).map(|w| w[1] - w[0]).collect();
            let mean_ibi = ibis.iter().sum::<f64>() / ibis.len() as f64;
            assert!(
                (mean_ibi - 0.5).abs() < 0.1,
                "expected ~0.5s between peaks, got {:.3}", mean_ibi
            );
        }
    }

    #[test]
    fn spectral_flux_activation_length() {
        let sr = 44100;
        let fps = 100.0;
        let signal = vec![0.0f32; sr * 3];
        let act = spectral_flux_activation(&signal, sr as u32, fps);
        assert!(act.len() >= 290 && act.len() <= 310,
            "expected ~300 frames, got {}", act.len());
    }

    #[test]
    fn spectral_flux_activation_peaks_on_beats() {
        let sr = 44100u32;
        let fps = 100.0;
        let bpm = 100.0;
        let signal = make_drum_signal(bpm, sr, 5.0);
        let act = spectral_flux_activation(&signal, sr, fps);

        let mut peaks = Vec::new();
        for i in 1..act.len() - 1 {
            if act[i] > 0.3 && act[i] >= act[i - 1] && act[i] >= act[i + 1] {
                peaks.push(i as f64 / fps);
            }
        }

        // 100 BPM, 5s = ~8 beats
        assert!(
            peaks.len() >= 6 && peaks.len() <= 12,
            "expected ~8 peaks at 100 BPM, got {}", peaks.len()
        );
    }

    #[test]
    fn energy_feeds_into_dbn() {
        use crate::dbn::{track_beats, BeatTrackerParams};

        let sr = 44100u32;
        let fps = 100.0;
        let bpm = 120.0;
        let signal = make_drum_signal(bpm, sr, 8.0);
        let act = energy_activation(&signal, sr, fps);

        let result = track_beats(&act, &BeatTrackerParams::default());

        // Should find ~16 beats in 8s at 120 BPM
        assert!(
            result.beats.len() >= 13 && result.beats.len() <= 19,
            "expected ~16 beats, got {}", result.beats.len()
        );
        assert!(
            (result.bpm - 120.0).abs() < 5.0,
            "expected ~120 BPM, got {:.1}", result.bpm
        );
    }

    #[test]
    fn empty_signal() {
        let act = energy_activation(&[], 44100, 100.0);
        assert!(act.is_empty());

        let act = spectral_flux_activation(&[], 44100, 100.0);
        assert!(act.is_empty());
    }
}
