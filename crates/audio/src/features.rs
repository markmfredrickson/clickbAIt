//! Per-frame audio features for visuals: loudness, onset strength, brightness,
//! and energy in three bands. Values stay in raw units (dB, Hz); scaling them
//! for display is the build's job, so it can be tuned without a rebuild.
//!
//! Frame `i` is centered at `i / fps` seconds.

use serde::Serialize;

/// Level reported for silence, in dB.
pub const FLOOR_DB: f64 = -120.0;

/// Upper edge of the low band (kick, bass fundamentals), in Hz.
pub const LOW_HZ: f64 = 150.0;
/// Upper edge of the mid band (snare body, voice); above it is the high band.
pub const MID_HZ: f64 = 2500.0;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    pub fps: f64,
    pub duration: f64,
    /// RMS level in dBFS.
    pub rms_db: Vec<f64>,
    /// Half-wave rectified spectral flux: how much new energy arrived.
    pub onset: Vec<f64>,
    /// Spectral centroid in Hz, 0 when the frame is silent.
    pub centroid_hz: Vec<f64>,
    pub low_db: Vec<f64>,
    pub mid_db: Vec<f64>,
    pub high_db: Vec<f64>,
}

/// Window for the band levels and centroid: long enough that a 100 Hz tone
/// stays out of the mid band.
const SPECTRUM_SIZE: usize = 2048;
/// Window for onsets: short, so a hit is reported on its own frame and not
/// one early.
const ONSET_SIZE: usize = 1024;

pub fn compute(samples: &[f32], sample_rate: u32, fps: f64) -> Features {
    let sr = sample_rate as f64;
    let duration = samples.len() as f64 / sr;
    let n_frames = (duration * fps).ceil() as usize;
    let hop = sr / fps;
    let rms_half = hop.round() as usize; // RMS over two hops, centered

    let mut spectrum = Spectrum::new(SPECTRUM_SIZE);
    let mut onset_spectrum = Spectrum::new(ONSET_SIZE);
    let mut prev_onset_mag = vec![0.0; ONSET_SIZE / 2 + 1];
    let bin_hz = sr / SPECTRUM_SIZE as f64;
    // rustfft is unnormalized: by Parseval the one-sided power sums to N² times
    // the windowed signal's mean square.
    let n = SPECTRUM_SIZE as f64;
    let scale = 2.0 / (n * n * spectrum.window_power);

    let mut f = Features {
        fps,
        duration,
        rms_db: Vec::with_capacity(n_frames),
        onset: Vec::with_capacity(n_frames),
        centroid_hz: Vec::with_capacity(n_frames),
        low_db: Vec::with_capacity(n_frames),
        mid_db: Vec::with_capacity(n_frames),
        high_db: Vec::with_capacity(n_frames),
    };

    for i in 0..n_frames {
        let center = (i as f64 * hop).round() as usize;

        let start = center.saturating_sub(rms_half);
        let end = (center + rms_half).min(samples.len());
        let ms = if end > start {
            samples[start..end].iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / (end - start) as f64
        } else {
            0.0
        };
        f.rms_db.push(to_db(ms));

        // Band power as the windowed signal's mean square, split by frequency.
        let mag = spectrum.magnitudes(samples, center);
        let (mut low, mut mid, mut high) = (0.0, 0.0, 0.0);
        let (mut weighted, mut total) = (0.0, 0.0);
        for (k, &m) in mag.iter().enumerate() {
            let hz = k as f64 * bin_hz;
            let p = m * m * scale;
            if hz < LOW_HZ {
                low += p;
            } else if hz < MID_HZ {
                mid += p;
            } else {
                high += p;
            }
            weighted += hz * m;
            total += m;
        }
        f.low_db.push(to_db(low));
        f.mid_db.push(to_db(mid));
        f.high_db.push(to_db(high));
        f.centroid_hz.push(if total > 1e-9 { weighted / total } else { 0.0 });

        let mag = onset_spectrum.magnitudes(samples, center);
        let flux: f64 = mag.iter().zip(&prev_onset_mag).map(|(m, p)| (m - p).max(0.0)).sum();
        f.onset.push(flux);
        prev_onset_mag.copy_from_slice(mag);
    }
    f
}

impl Features {
    /// Round every value to `places` decimals, to keep the JSON small.
    pub fn round(&mut self, places: i32) {
        let k = 10f64.powi(places);
        for v in [&mut self.rms_db, &mut self.onset, &mut self.centroid_hz, &mut self.low_db, &mut self.mid_db, &mut self.high_db] {
            v.iter_mut().for_each(|x| *x = (*x * k).round() / k);
        }
    }
}

fn to_db(power: f64) -> f64 {
    if power <= 1e-12 {
        FLOOR_DB
    } else {
        (10.0 * power.log10()).max(FLOOR_DB)
    }
}

/// A Hann-windowed FFT taken around a sample position, zero-padded past the
/// ends of the signal.
struct Spectrum {
    size: usize,
    window: Vec<f64>,
    /// Mean of the squared window, for scaling power back to the signal's.
    window_power: f64,
    fft: std::sync::Arc<dyn rustfft::Fft<f64>>,
    buf: Vec<rustfft::num_complex::Complex<f64>>,
    mag: Vec<f64>,
}

impl Spectrum {
    fn new(size: usize) -> Self {
        let window: Vec<f64> = (0..size)
            .map(|i| 0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / size as f64).cos()))
            .collect();
        let window_power = window.iter().map(|w| w * w).sum::<f64>() / size as f64;
        Spectrum {
            size,
            window,
            window_power,
            fft: rustfft::FftPlanner::new().plan_fft_forward(size),
            buf: vec![rustfft::num_complex::Complex::new(0.0, 0.0); size],
            mag: vec![0.0; size / 2 + 1],
        }
    }

    fn magnitudes(&mut self, samples: &[f32], center: usize) -> &[f64] {
        let half = self.size / 2;
        for j in 0..self.size {
            let s = (center + j).checked_sub(half).and_then(|idx| samples.get(idx)).copied().unwrap_or(0.0);
            self.buf[j] = rustfft::num_complex::Complex::new(s as f64 * self.window[j], 0.0);
        }
        self.fft.process(&mut self.buf);
        for (m, c) in self.mag.iter_mut().zip(&self.buf) {
            *m = c.norm();
        }
        &self.mag
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    const SR: u32 = 44100;
    const FPS: f64 = 100.0;

    fn sine(freq: f64, amp: f64, secs: f64) -> Vec<f32> {
        let n = (secs * SR as f64) as usize;
        (0..n).map(|i| (amp * (2.0 * PI * freq * i as f64 / SR as f64).sin()) as f32).collect()
    }

    /// Mean of a feature over the middle of the signal, away from the edges.
    fn middle_mean(v: &[f64]) -> f64 {
        let (a, b) = (v.len() / 4, 3 * v.len() / 4);
        v[a..b].iter().sum::<f64>() / (b - a) as f64
    }

    #[test]
    fn silence_stays_at_the_floor() {
        let f = compute(&vec![0.0; SR as usize * 2], SR, FPS);
        for (name, v) in [("rms", &f.rms_db), ("low", &f.low_db), ("mid", &f.mid_db), ("high", &f.high_db)] {
            assert!(v.iter().all(|&x| x == FLOOR_DB), "{name} should sit at the floor");
        }
        assert!(f.onset.iter().all(|&x| x == 0.0), "no onsets in silence");
        assert!(f.centroid_hz.iter().all(|&x| x == 0.0), "no centroid in silence");
    }

    #[test]
    fn low_and_high_tones_land_in_their_bands() {
        let low = compute(&sine(100.0, 0.5, 2.0), SR, FPS);
        let high = compute(&sine(5000.0, 0.5, 2.0), SR, FPS);

        let (lc, hc) = (middle_mean(&low.centroid_hz), middle_mean(&high.centroid_hz));
        assert!(lc < 300.0, "100 Hz centroid was {lc:.0}");
        assert!(hc > 3000.0, "5 kHz centroid was {hc:.0}");

        assert!(middle_mean(&low.low_db) > middle_mean(&low.high_db) + 30.0);
        assert!(middle_mean(&low.low_db) > middle_mean(&low.mid_db) + 20.0);
        assert!(middle_mean(&high.high_db) > middle_mean(&high.low_db) + 30.0);
        assert!(middle_mean(&high.high_db) > middle_mean(&high.mid_db) + 20.0);

        // A pure tone's level all lands in one band, so that band matches the RMS.
        let (band, rms) = (middle_mean(&low.low_db), middle_mean(&low.rms_db));
        assert!((band - rms).abs() < 1.0, "low band {band:.1} dB vs RMS {rms:.1} dB");
        let (band, rms) = (middle_mean(&high.high_db), middle_mean(&high.rms_db));
        assert!((band - rms).abs() < 1.0, "high band {band:.1} dB vs RMS {rms:.1} dB");
    }

    #[test]
    fn onsets_peak_on_each_click() {
        // A short decaying burst every 0.5 s, starting at 0.25 s.
        let secs = 4.0;
        let mut s = vec![0.0f32; (secs * SR as f64) as usize];
        let clicks: Vec<f64> = (0..8).map(|k| 0.25 + 0.5 * k as f64).collect();
        let burst = (0.01 * SR as f64) as usize;
        for &t in &clicks {
            let start = (t * SR as f64) as usize;
            for j in 0..burst {
                let env = (-6.0 * j as f64 / burst as f64).exp();
                s[start + j] += (0.8 * env * (2.0 * PI * 3000.0 * j as f64 / SR as f64).sin()) as f32;
            }
        }
        let f = compute(&s, SR, FPS);
        let max = f.onset.iter().cloned().fold(0.0, f64::max);
        let peaks: Vec<usize> = (1..f.onset.len() - 1)
            .filter(|&i| f.onset[i] > 0.3 * max && f.onset[i] >= f.onset[i - 1] && f.onset[i] > f.onset[i + 1])
            .collect();

        assert_eq!(peaks.len(), clicks.len(), "one peak per click, got {peaks:?}");
        for (&p, &t) in peaks.iter().zip(&clicks) {
            let want = (t * FPS).round() as i64;
            assert!((p as i64 - want).abs() <= 1, "click at {t}s peaked at frame {p}, want {want}±1");
        }
    }

    #[test]
    fn loudness_steps_up_with_the_signal() {
        let mut s = sine(440.0, 0.05, 1.0);
        s.extend(sine(440.0, 0.5, 1.0));
        let f = compute(&s, SR, FPS);

        let quiet = f.rms_db[50];
        let loud = f.rms_db[150];
        assert!((loud - quiet - 20.0).abs() < 1.0, "a 10x amplitude step is 20 dB, got {:.1}", loud - quiet);

        let mid = (quiet + loud) / 2.0;
        let crossing = f.rms_db.iter().position(|&x| x > mid).unwrap() as i64;
        assert!((crossing - 100).abs() <= 1, "loudness crossed the midpoint at frame {crossing}, want 100±1");
    }

    #[test]
    fn frames_cover_the_file() {
        let secs = 2.345;
        let f = compute(&vec![0.0; (secs * SR as f64) as usize], SR, FPS);
        let n = (secs * FPS).ceil() as usize;
        assert!((f.duration - secs).abs() < 1e-3);
        assert_eq!(f.fps, FPS);
        for (name, len) in [
            ("rms", f.rms_db.len()),
            ("onset", f.onset.len()),
            ("centroid", f.centroid_hz.len()),
            ("low", f.low_db.len()),
            ("mid", f.mid_db.len()),
            ("high", f.high_db.len()),
        ] {
            assert_eq!(len, n, "{name} has {len} frames, want {n}");
        }
    }
}
