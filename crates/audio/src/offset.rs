//! Find where a clip (a phone video's sound) starts inside a longer reference
//! recording (the board audio from the same gig).
//!
//! Both signals are cross-correlated with GCC-PHAT, which whitens the spectrum
//! so the match rests on timing rather than on tone: a phone across the room and
//! the board hear the same performance through very different filters. A coarse
//! pass over the whole reference finds the clip, a fine pass around that spot
//! pins it to a fraction of a millisecond, and short windows along the clip
//! measure how fast the phone's clock runs against the board's.

use anyhow::{bail, Result};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;

/// Rate for the search over the whole reference (a 54-minute set fits one FFT).
const COARSE_SR: u32 = 4000;
/// Rate for pinning the offset once the search has found it.
const FINE_SR: u32 = 16000;
/// The best peak must beat every peak elsewhere by this factor, or the match is ambiguous.
const MIN_PEAK_RATIO: f64 = 1.5;
/// Peaks this close to the best one belong to it (echoes, filter ringing).
const EXCLUDE_S: f64 = 0.05;
/// Slack around the coarse offset for the fine pass and the drift windows.
const SEARCH_S: f64 = 0.1;
/// Fade at both ends of every signal before correlating. Without it an abrupt
/// start or end is a click, and whitening turns two clicks lining up into a peak.
const TAPER_S: f64 = 0.05;
/// Length of each drift window; drift needs at least three of them.
const DRIFT_WINDOW_S: f64 = 20.0;

#[derive(Debug, Serialize)]
pub struct Offset {
    /// Reference time (seconds) at which the clip's first sample plays.
    pub offset: f64,
    /// Height of the best correlation peak over the best one elsewhere.
    pub peak_ratio: f64,
    /// How much faster the clip's clock runs than the reference's, in parts per
    /// million; absent when the clip is too short to measure it.
    pub drift_ppm: Option<f64>,
}

/// `find_offset` over the reference from `from` seconds on (after the previous
/// song in a set, say), with the offset still counted from the reference's start.
pub fn find_offset_from(reference: &[f32], ref_sr: u32, clip: &[f32], clip_sr: u32, from: f64) -> Result<Offset> {
    let skip = ((from.max(0.0) * ref_sr as f64).round() as usize).min(reference.len());
    let mut found = find_offset(&reference[skip..], ref_sr, clip, clip_sr)?;
    found.offset += skip as f64 / ref_sr as f64;
    Ok(found)
}

pub fn find_offset(reference: &[f32], ref_sr: u32, clip: &[f32], clip_sr: u32) -> Result<Offset> {
    // Coarse: the whole clip against the reference in overlapping pieces twice its
    // length. Whitening one cross-spectrum of a whole set against one song drowns
    // the song's match in the rest of the set; in a piece the clip is half of it.
    let ref_c = resample(reference, ref_sr, COARSE_SR)?;
    let clip_c = resample(clip, clip_sr, COARSE_SR)?;
    let half = clip_c.len() as i64 / 2;
    let exclude = (EXCLUDE_S * COARSE_SR as f64) as i64;
    let hop = clip_c.len().max(1);
    let mut peaks: Vec<Peaks> = Vec::new();
    let mut start = 0;
    loop {
        let piece = &ref_c[start..(start + 2 * hop).min(ref_c.len())];
        let corr = gcc_phat(piece, &clip_c, COARSE_SR);
        let lo = if start == 0 { -half } else { 0 };
        let p = peaks_in(&corr, lo, piece.len() as i64 - half, exclude);
        peaks.push(p.shifted(start as i64));
        if start + 2 * hop >= ref_c.len() {
            break;
        }
        start += hop;
    }
    let best = peaks.iter().map(|p| p.top).max_by(|a, b| a.1.total_cmp(&b.1)).unwrap();
    let next = peaks
        .iter()
        .flat_map(|p| [p.top, p.next])
        .filter(|&(l, _)| (l - best.0).abs() > exclude)
        .map(|(_, v)| v)
        .fold(0.0f32, f32::max);
    let lag = best.0;
    let peak_ratio = if next > 0.0 { (best.1 / next) as f64 } else { f64::INFINITY };
    if peak_ratio < MIN_PEAK_RATIO {
        bail!("ambiguous match: best peak at {:.3}s is only {peak_ratio:.2}x the next \
               (need {MIN_PEAK_RATIO}x)", lag as f64 / COARSE_SR as f64);
    }
    let coarse = lag as f64 / COARSE_SR as f64;

    // Fine: the whole clip again, against just the stretch of reference it covers.
    let clip_f = resample(clip, clip_sr, FINE_SR)?;
    let clip_secs = clip.len() as f64 / clip_sr as f64;
    let offset = locate(reference, ref_sr, &clip_f, coarse, clip_secs)?
        .map(|(t, _)| t)
        .unwrap_or(coarse);

    // Drift: where each window of the clip lands, as a straight line over clip time.
    let win = (DRIFT_WINDOW_S * FINE_SR as f64) as usize;
    let mut points = Vec::new();
    for start in (0..clip_f.len().saturating_sub(win - 1)).step_by(win) {
        let t = start as f64 / FINE_SR as f64;
        if let Some((at, ratio)) = locate(reference, ref_sr, &clip_f[start..start + win], offset + t, DRIFT_WINDOW_S)? {
            if ratio >= MIN_PEAK_RATIO {
                points.push((t, at - t));
            }
        }
    }
    if points.len() < 3 {
        return Ok(Offset { offset, peak_ratio, drift_ppm: None });
    }
    let (slope, intercept) = fit_line(&points);
    Ok(Offset { offset: intercept, peak_ratio, drift_ppm: Some(slope * 1e6) })
}

/// Where `clip` (at FINE_SR) starts in `reference`, searching `SEARCH_S` either side of
/// `guess`. Returns the reference time and the peak ratio, or None when the stretch
/// of reference around the guess is empty.
fn locate(reference: &[f32], ref_sr: u32, clip: &[f32], guess: f64, clip_secs: f64) -> Result<Option<(f64, f64)>> {
    let to_sample = |t: f64| ((t * ref_sr as f64).round().max(0.0) as usize).min(reference.len());
    let a = to_sample(guess - SEARCH_S);
    let b = to_sample(guess + clip_secs + SEARCH_S);
    if b <= a {
        return Ok(None);
    }
    let slice_start = a as f64 / ref_sr as f64;
    let slice = resample(&reference[a..b], ref_sr, FINE_SR)?;
    let corr = gcc_phat(&slice, clip, FINE_SR);
    let centre = ((guess - slice_start) * FINE_SR as f64).round() as i64;
    let reach = (SEARCH_S * FINE_SR as f64) as i64;
    let exclude = (EXCLUDE_S * FINE_SR as f64) as i64;
    let p = peaks_in(&corr, centre - reach, centre + reach, exclude);
    let (lag, ratio) = (p.top.0, p.ratio());
    let at = (lag as f64 + parabolic(&corr, lag)) / FINE_SR as f64;
    Ok(Some((slice_start + at, ratio)))
}

/// GCC-PHAT cross-correlation. Entry `lag` (wrapped modulo the length for negative
/// lags) scores the clip's first sample lining up with `reference[lag]`.
fn gcc_phat(reference: &[f32], clip: &[f32], sr: u32) -> Vec<f32> {
    let taper = (TAPER_S * sr as f64) as usize;
    let n = (reference.len() + clip.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let spectrum = |x: &[f32]| {
        let mut buf = vec![Complex::new(0.0f32, 0.0); n];
        let fade = taper.min(x.len() / 2);
        for (i, (b, &v)) in buf.iter_mut().zip(x).enumerate() {
            let edge = i.min(x.len() - 1 - i);
            let w = if edge < fade { 0.5 - 0.5 * (std::f32::consts::PI * edge as f32 / fade as f32).cos() } else { 1.0 };
            b.re = v * w;
        }
        fft.process(&mut buf);
        buf
    };
    let mut cross = spectrum(reference);
    let c = spectrum(clip);
    for (x, y) in cross.iter_mut().zip(&c) {
        let p = *x * y.conj();
        let m = p.norm();
        *x = if m > 0.0 { p / m } else { Complex::new(0.0, 0.0) };
    }
    planner.plan_fft_inverse(n).process(&mut cross);
    cross.iter().map(|x| x.re).collect()
}

fn at(corr: &[f32], lag: i64) -> f32 {
    corr[lag.rem_euclid(corr.len() as i64) as usize].abs()
}

/// The highest correlation peak and the highest one more than `exclude` lags
/// away from it, as (lag, height).
#[derive(Clone, Copy)]
struct Peaks {
    top: (i64, f32),
    next: (i64, f32),
}

impl Peaks {
    fn ratio(&self) -> f64 {
        if self.next.1 > 0.0 { (self.top.1 / self.next.1) as f64 } else { f64::INFINITY }
    }

    fn shifted(self, by: i64) -> Peaks {
        Peaks { top: (self.top.0 + by, self.top.1), next: (self.next.0 + by, self.next.1) }
    }
}

/// The peaks with lag in `lo..hi`.
fn peaks_in(corr: &[f32], lo: i64, hi: i64, exclude: i64) -> Peaks {
    let (lo, hi) = (lo.max(1 - corr.len() as i64 / 2), hi.min(corr.len() as i64 / 2));
    let top = (lo..hi).max_by(|&a, &b| at(corr, a).total_cmp(&at(corr, b))).unwrap_or(0);
    let next = (lo..hi)
        .filter(|l| (l - top).abs() > exclude)
        .max_by(|&a, &b| at(corr, a).total_cmp(&at(corr, b)))
        .unwrap_or(top);
    Peaks { top: (top, at(corr, top)), next: (next, if next == top { 0.0 } else { at(corr, next) }) }
}

/// Sub-sample position of a peak, from a parabola through it and its neighbours.
fn parabolic(corr: &[f32], lag: i64) -> f64 {
    let (y0, y1, y2) = (at(corr, lag - 1) as f64, at(corr, lag) as f64, at(corr, lag + 1) as f64);
    let d = y0 - 2.0 * y1 + y2;
    if d.abs() < 1e-12 { 0.0 } else { (0.5 * (y0 - y2) / d).clamp(-0.5, 0.5) }
}

/// Least-squares line through `(x, y)` points: (slope, intercept).
fn fit_line(points: &[(f64, f64)]) -> (f64, f64) {
    let n = points.len() as f64;
    let mx = points.iter().map(|p| p.0).sum::<f64>() / n;
    let my = points.iter().map(|p| p.1).sum::<f64>() / n;
    let sxy: f64 = points.iter().map(|p| (p.0 - mx) * (p.1 - my)).sum();
    let sxx: f64 = points.iter().map(|p| (p.0 - mx).powi(2)).sum();
    let slope = sxy / sxx;
    (slope, my - slope * mx)
}

/// Resample with the resampler's own delay removed, so sample `i` of the output
/// sits at time `i / to` exactly like sample `i * from / to` of the input.
fn resample(samples: &[f32], from: u32, to: u32) -> Result<Vec<f32>> {
    if from == to {
        return Ok(samples.to_vec());
    }
    use rubato::{FftFixedIn, Resampler};
    let chunk = 1024;
    let mut r = FftFixedIn::<f32>::new(from as usize, to as usize, chunk, 2, 1)?;
    let delay = r.output_delay();
    let want = (samples.len() as u64 * to as u64 / from as u64) as usize;
    let mut out = Vec::with_capacity(want + delay + chunk);
    let mut buf = vec![vec![0.0f32; chunk]];
    let mut pos = 0;
    while out.len() < want + delay {
        let n = chunk.min(samples.len().saturating_sub(pos));
        buf[0][..n].copy_from_slice(&samples[pos..pos + n]);
        buf[0][n..].fill(0.0);
        pos += n;
        out.extend_from_slice(&r.process(&buf, None)?[0]);
    }
    out.drain(..delay);
    out.truncate(want);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A deterministic stand-in for a band: random partials under a train of
    /// decaying notes, defined in continuous time so it can be sampled at any
    /// rate or clock speed without a resampler in the way.
    struct Band {
        partials: Vec<(f64, f64, f64)>, // (hz, phase, amplitude)
        notes: Vec<(f64, f64)>,         // (start seconds, loudness)
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    impl Band {
        fn new(seed: u64, secs: f64) -> Band {
            let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
            let partials = (0..60)
                .map(|_| (40.0 + 6000.0 * rng.next(), std::f64::consts::TAU * rng.next(), 0.2 + rng.next()))
                .collect();
            let mut notes = Vec::new();
            let mut t = 0.0;
            while t < secs + 1.0 {
                notes.push((t, 0.2 + rng.next()));
                t += 0.1 + 0.3 * rng.next();
            }
            Band { partials, notes }
        }

        fn envelope(&self, t: f64) -> f64 {
            let i = self.notes.partition_point(|n| n.0 <= t).saturating_sub(1);
            let (start, loud) = self.notes[i];
            loud * (-(t - start).max(0.0) * 6.0).exp()
        }

        /// `n` samples at `sr`, the first at time `t0`, on a clock running `ppm` fast.
        fn render(&self, t0: f64, n: usize, sr: u32, ppm: f64) -> Vec<f32> {
            let dt = (1.0 + ppm * 1e-6) / sr as f64;
            let tone = |t: f64| self.partials.iter().map(|&(hz, ph, a)| a * (std::f64::consts::TAU * hz * t + ph).sin()).sum::<f64>();
            (0..n).map(|i| { let t = t0 + i as f64 * dt; (0.05 * self.envelope(t) * tone(t)) as f32 }).collect()
        }
    }

    const SR: u32 = 48000;

    fn secs(s: f64, sr: u32) -> usize {
        (s * sr as f64) as usize
    }

    /// What a phone across the room hears: quieter, duller, an echo off the back
    /// wall and crowd noise about half as loud as the band.
    fn room(clip: &[f32], sr: u32) -> Vec<f32> {
        let a = (-std::f64::consts::TAU * 2000.0 / sr as f64).exp() as f32;
        let mut y = 0.0f32;
        let dull: Vec<f32> = clip.iter().map(|&x| { y = (1.0 - a) * x + a * y; 0.3 * y }).collect();
        let echo = secs(0.023, sr);
        let rms = (dull.iter().map(|x| x * x).sum::<f32>() / dull.len() as f32).sqrt();
        let mut rng = Rng(77);
        (0..dull.len())
            .map(|i| {
                let e = if i >= echo { 0.5 * dull[i - echo] } else { 0.0 };
                dull[i] + e + rms * (rng.next() as f32 - 0.5) * 1.7
            })
            .collect()
    }

    #[test]
    fn finds_a_clip_through_room_sound() {
        let band = Band::new(1, 60.0);
        let board = band.render(0.0, secs(60.0, SR), SR, 0.0);
        let phone = room(&band.render(23.4567, secs(20.0, SR), SR, 0.0), SR);
        let got = find_offset(&board, SR, &phone, SR).unwrap();
        assert!((got.offset - 23.4567).abs() < 0.001, "offset {}", got.offset);
        assert!(got.peak_ratio >= MIN_PEAK_RATIO);
    }

    #[test]
    fn finds_a_song_in_a_whole_set() {
        // Most of what the phone hears never reaches the board (drums, amps, the
        // room), so the board's share of the clip is small. Against a whole set
        // the rest of the set must not drown that share out.
        const SR: u32 = 8000;
        let set = Band::new(7, 900.0);
        let board = set.render(0.0, secs(900.0, SR), SR, 0.0);
        let song = set.render(612.5, secs(60.0, SR), SR, 0.0);
        let stage = Band::new(8, 60.0).render(0.0, secs(60.0, SR), SR, 0.0);
        let phone: Vec<f32> = song.iter().zip(&stage).map(|(b, s)| 0.15 * b + s).collect();
        let got = find_offset(&board, SR, &phone, SR).unwrap();
        assert!((got.offset - 612.5).abs() < 0.001, "offset {}", got.offset);
    }

    #[test]
    fn matches_across_sample_rates() {
        let band = Band::new(2, 60.0);
        let board = band.render(0.0, secs(60.0, SR), SR, 0.0);
        let phone = band.render(23.4567, secs(20.0, 44100), 44100, 0.0);
        let got = find_offset(&board, SR, &phone, 44100).unwrap();
        assert!((got.offset - 23.4567).abs() < 0.001, "offset {}", got.offset);
    }

    #[test]
    fn rejects_a_clip_from_somewhere_else() {
        let board = Band::new(3, 60.0).render(0.0, secs(60.0, SR), SR, 0.0);
        let phone = Band::new(4, 20.0).render(0.0, secs(20.0, SR), SR, 0.0);
        let err = find_offset(&board, SR, &phone, SR).unwrap_err();
        assert!(err.to_string().contains("ambiguous"), "{err}");
    }

    #[test]
    fn rejects_a_clip_from_a_repeated_section() {
        // Seconds 30–40 of the board replay seconds 10–20, like a second chorus
        // that is the same take; the clip sits inside both.
        let band = Band::new(5, 60.0);
        let mut board = band.render(0.0, secs(60.0, SR), SR, 0.0);
        let repeat = band.render(10.0, secs(10.0, SR), SR, 0.0);
        board[secs(30.0, SR)..secs(40.0, SR)].copy_from_slice(&repeat);
        let phone = band.render(12.0, secs(5.0, SR), SR, 0.0);
        let err = find_offset(&board, SR, &phone, SR).unwrap_err();
        assert!(err.to_string().contains("ambiguous"), "{err}");
    }

    #[test]
    fn finds_a_repeated_section_after_a_given_time_counting_from_the_reference_start() {
        // As above: the clip's music is at 12 s and again at 32 s. Searching
        // from 25 s (after the previous song, say) leaves only the second.
        let band = Band::new(5, 60.0);
        let mut board = band.render(0.0, secs(60.0, SR), SR, 0.0);
        let repeat = band.render(10.0, secs(10.0, SR), SR, 0.0);
        board[secs(30.0, SR)..secs(40.0, SR)].copy_from_slice(&repeat);
        let phone = band.render(12.0, secs(5.0, SR), SR, 0.0);
        let got = find_offset_from(&board, SR, &phone, SR, 25.0).unwrap();
        assert!((got.offset - 32.0).abs() < 0.001, "offset {}", got.offset);
    }

    #[test]
    fn measures_clock_drift() {
        let band = Band::new(6, 100.0);
        let board = band.render(0.0, secs(100.0, SR), SR, 0.0);
        let phone = band.render(5.25, secs(90.0, SR), SR, 50.0);
        let got = find_offset(&board, SR, &phone, SR).unwrap();
        let drift = got.drift_ppm.expect("a 90 s clip is long enough to measure drift");
        assert!((drift - 50.0).abs() < 10.0, "drift {drift} ppm");
        assert!((got.offset - 5.25).abs() < 0.001, "offset {}", got.offset);
    }
}
