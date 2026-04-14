//! DBN beat tracker — port of madmom's DBNBeatTrackingProcessor.
//!
//! Reference: Böck, Krebs & Widmer (2016), "Joint Beat and Downbeat Tracking
//! with Recurrent Neural Networks." BSD-2 licensed original at
//! github.com/CPJKU/madmom.
//!
//! The algorithm uses a Hidden Markov Model where each hidden state encodes
//! (position-within-beat, tempo). A Viterbi decoder finds the optimal beat
//! sequence given a 1-D beat activation signal.

use serde::Serialize;

// ---------------------------------------------------------------------------
// Beat state space
// ---------------------------------------------------------------------------

/// The state space for the beat tracker HMM.
///
/// Each state is a (position, interval) pair. `position` runs from 0.0
/// (on the beat) to just under 1.0 (one frame before the next beat).
/// `interval` is the beat period in frames at the given tempo.
pub struct BeatStateSpace {
    /// Position within beat for each state (0.0 = beat, approaches 1.0).
    pub positions: Vec<f64>,
    /// Beat interval (frames) for each state's tempo.
    pub intervals: Vec<u32>,
    /// Index of the first state (position=0) for each distinct interval.
    pub first_states: Vec<usize>,
    /// Index of the last state for each distinct interval.
    pub last_states: Vec<usize>,
    /// The distinct interval values.
    pub unique_intervals: Vec<u32>,
}

impl BeatStateSpace {
    /// Build the state space for tempos between `min_bpm` and `max_bpm`
    /// at the given frames-per-second.
    pub fn new(min_bpm: f64, max_bpm: f64, fps: f64) -> Self {
        let min_interval = (60.0 * fps / max_bpm).round() as u32;
        let max_interval = (60.0 * fps / min_bpm).round() as u32;

        let mut positions = Vec::new();
        let mut intervals = Vec::new();
        let mut first_states = Vec::new();
        let mut last_states = Vec::new();
        let mut unique_intervals = Vec::new();

        for iv in min_interval..=max_interval {
            let start = positions.len();
            unique_intervals.push(iv);
            first_states.push(start);
            for p in 0..iv {
                positions.push(p as f64 / iv as f64);
                intervals.push(iv);
            }
            last_states.push(positions.len() - 1);
        }

        BeatStateSpace {
            positions,
            intervals,
            first_states,
            last_states,
            unique_intervals,
        }
    }

    pub fn num_states(&self) -> usize {
        self.positions.len()
    }

    pub fn num_tempi(&self) -> usize {
        self.unique_intervals.len()
    }
}

// ---------------------------------------------------------------------------
// Sparse transition model (CSR, indexed by destination)
// ---------------------------------------------------------------------------

/// Compressed sparse row transition model. For each destination state,
/// stores which source states can transition into it and with what
/// (log) probability.
pub struct TransitionModel {
    /// Source states, packed contiguously per destination.
    pub sources: Vec<u32>,
    /// Log-probabilities corresponding to each entry in `sources`.
    pub log_probs: Vec<f64>,
    /// `pointers[s]..pointers[s+1]` indexes into sources/log_probs for
    /// destination state `s`.
    pub pointers: Vec<usize>,
}

impl TransitionModel {
    /// Build the transition model from a beat state space.
    ///
    /// `transition_lambda` controls tempo-change penalty:
    ///   P(interval_j | interval_k) ∝ exp(-λ |ratio - 1|)
    pub fn new(ss: &BeatStateSpace, transition_lambda: f64) -> Self {
        let n = ss.num_states();
        let n_tempi = ss.num_tempi();

        // Pre-compute tempo transition log-probs (normalized per source tempo).
        // tempo_log_prob[from_idx][to_idx]
        let mut tempo_log_prob: Vec<Vec<f64>> = Vec::with_capacity(n_tempi);
        for i in 0..n_tempi {
            let from_iv = ss.unique_intervals[i] as f64;
            let mut row = Vec::with_capacity(n_tempi);
            let mut sum = 0.0_f64;
            for j in 0..n_tempi {
                let to_iv = ss.unique_intervals[j] as f64;
                let ratio = to_iv / from_iv;
                let p = (-transition_lambda * (ratio - 1.0).abs()).exp();
                row.push(p);
                sum += p;
            }
            // Normalize and take log
            for p in &mut row {
                *p = (*p / sum).ln();
            }
            tempo_log_prob.push(row);
        }

        // Build CSR indexed by destination.
        // For each destination state, collect (source, log_prob) pairs.
        let mut sources = Vec::new();
        let mut log_probs = Vec::new();
        let mut pointers = Vec::with_capacity(n + 1);

        for dest in 0..n {
            pointers.push(sources.len());

            // Is this a first_state (position=0)? Then it receives transitions
            // from all last_states (beat boundary crossings).
            if let Some(dest_tempo_idx) = ss.first_states.iter().position(|&f| f == dest) {
                for src_tempo_idx in 0..n_tempi {
                    let src = ss.last_states[src_tempo_idx];
                    sources.push(src as u32);
                    log_probs.push(tempo_log_prob[src_tempo_idx][dest_tempo_idx]);
                }
            } else {
                // Within-beat: deterministic from dest-1
                sources.push((dest - 1) as u32);
                log_probs.push(0.0); // log(1.0)
            }
        }
        pointers.push(sources.len());

        TransitionModel {
            sources,
            log_probs,
            pointers,
        }
    }
}

// ---------------------------------------------------------------------------
// Observation model
// ---------------------------------------------------------------------------

/// Maps beat activation values to log observation densities.
pub struct ObservationModel {
    /// For each state: 1 if "beat state" (near position 0), 0 otherwise.
    pub pointers: Vec<u8>,
    /// observation_lambda — beat states occupy 1/lambda of each beat period.
    pub lambda: f64,
}

impl ObservationModel {
    pub fn new(ss: &BeatStateSpace, observation_lambda: f64) -> Self {
        let threshold = 1.0 / observation_lambda;
        let pointers: Vec<u8> = ss
            .positions
            .iter()
            .map(|&p| if p < threshold { 1 } else { 0 })
            .collect();
        ObservationModel {
            pointers,
            lambda: observation_lambda,
        }
    }

    /// Log-density for a beat state given activation `a`.
    #[inline]
    pub fn log_density_beat(&self, a: f64) -> f64 {
        a.max(1e-20).ln()
    }

    /// Log-density for a non-beat state given activation `a`.
    #[inline]
    pub fn log_density_no_beat(&self, a: f64) -> f64 {
        ((1.0 - a).max(1e-20) / (self.lambda - 1.0)).ln()
    }
}

// ---------------------------------------------------------------------------
// Viterbi decoder
// ---------------------------------------------------------------------------

/// Run the Viterbi algorithm over the activation sequence.
///
/// Returns the decoded state-index path (one per frame).
pub fn viterbi(
    activations: &[f64],
    tm: &TransitionModel,
    om: &ObservationModel,
    n_states: usize,
) -> Vec<u32> {
    let n_frames = activations.len();
    if n_frames == 0 {
        return Vec::new();
    }

    let init = (1.0 / n_states as f64).ln();

    // Current and previous Viterbi scores
    let mut prev = vec![f64::NEG_INFINITY; n_states];
    let mut curr = vec![f64::NEG_INFINITY; n_states];

    // Backtrack matrix: backtrack[t * n_states + s] = predecessor state
    let mut backtrack: Vec<u32> = vec![0; n_frames * n_states];

    // Initialize with first frame
    let a = activations[0];
    let log_beat = om.log_density_beat(a);
    let log_no_beat = om.log_density_no_beat(a);
    for s in 0..n_states {
        let density = if om.pointers[s] == 1 { log_beat } else { log_no_beat };
        prev[s] = init + density;
    }

    // Forward pass
    for t in 1..n_frames {
        let a = activations[t];
        let log_beat = om.log_density_beat(a);
        let log_no_beat = om.log_density_no_beat(a);

        for s in 0..n_states {
            let density = if om.pointers[s] == 1 { log_beat } else { log_no_beat };

            let mut best_score = f64::NEG_INFINITY;
            let mut best_pred = 0u32;

            let start = tm.pointers[s];
            let end = tm.pointers[s + 1];
            for idx in start..end {
                let pred = tm.sources[idx] as usize;
                let score = prev[pred] + tm.log_probs[idx];
                if score > best_score {
                    best_score = score;
                    best_pred = pred as u32;
                }
            }

            curr[s] = best_score + density;
            backtrack[t * n_states + s] = best_pred;
        }

        std::mem::swap(&mut prev, &mut curr);
        curr.fill(f64::NEG_INFINITY);
    }

    // Backtrace
    let mut path = vec![0u32; n_frames];
    path[n_frames - 1] = prev
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i, _)| i as u32)
        .unwrap_or(0);

    for t in (0..n_frames - 1).rev() {
        path[t] = backtrack[(t + 1) * n_states + path[t + 1] as usize];
    }

    path
}

// ---------------------------------------------------------------------------
// Beat extraction from decoded path
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Beat {
    /// Time in seconds.
    pub time: f64,
    /// Activation strength at this beat.
    pub strength: f64,
}

/// Extract beat times from the Viterbi path by finding activation peaks
/// within beat regions (where the state is near position 0).
pub fn extract_beats(
    path: &[u32],
    activations: &[f64],
    om: &ObservationModel,
    fps: f64,
) -> Vec<Beat> {
    let n = path.len();
    if n == 0 {
        return Vec::new();
    }

    let mut beats = Vec::new();
    let mut in_beat_region = false;
    let mut region_start = 0usize;

    for i in 0..=n {
        let is_beat = i < n && om.pointers[path[i] as usize] == 1;

        if is_beat && !in_beat_region {
            region_start = i;
            in_beat_region = true;
        } else if !is_beat && in_beat_region {
            // End of beat region — pick the frame with highest activation
            let best = (region_start..i)
                .max_by(|&a, &b| {
                    activations[a]
                        .partial_cmp(&activations[b])
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap_or(region_start);

            beats.push(Beat {
                time: best as f64 / fps,
                strength: activations[best],
            });
            in_beat_region = false;
        }
    }

    beats
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Parameters for the DBN beat tracker.
pub struct BeatTrackerParams {
    pub min_bpm: f64,
    pub max_bpm: f64,
    pub fps: f64,
    pub transition_lambda: f64,
    pub observation_lambda: f64,
}

impl Default for BeatTrackerParams {
    fn default() -> Self {
        BeatTrackerParams {
            min_bpm: 55.0,
            max_bpm: 215.0,
            fps: 100.0,
            transition_lambda: 100.0,
            observation_lambda: 16.0,
        }
    }
}

/// Result of beat tracking.
#[derive(Debug, Serialize)]
pub struct BeatTrackResult {
    pub beats: Vec<Beat>,
    pub bpm: f64,
}

/// Run the full DBN beat tracker on a beat activation signal.
///
/// `activations` should be a 1-D signal at `params.fps` frames per second,
/// with values in [0, 1] indicating beat likelihood.
pub fn track_beats(activations: &[f64], params: &BeatTrackerParams) -> BeatTrackResult {
    let ss = BeatStateSpace::new(params.min_bpm, params.max_bpm, params.fps);
    let tm = TransitionModel::new(&ss, params.transition_lambda);
    let om = ObservationModel::new(&ss, params.observation_lambda);

    let path = viterbi(activations, &tm, &om, ss.num_states());
    let beats = extract_beats(&path, activations, &om, params.fps);

    let bpm = estimate_bpm_from_beats(&beats);

    BeatTrackResult { beats, bpm }
}

/// Estimate BPM from extracted beat times using median inter-beat interval.
fn estimate_bpm_from_beats(beats: &[Beat]) -> f64 {
    if beats.len() < 2 {
        return 0.0;
    }

    let mut ibis: Vec<f64> = beats.windows(2).map(|w| w[1].time - w[0].time).collect();
    ibis.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = ibis[ibis.len() / 2];

    if median > 0.0 {
        60.0 / median
    } else {
        0.0
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- State space --

    #[test]
    fn state_space_count() {
        // 120 BPM only: interval = 60*100/120 = 50 frames
        let ss = BeatStateSpace::new(120.0, 120.0, 100.0);
        assert_eq!(ss.num_states(), 50);
        assert_eq!(ss.num_tempi(), 1);
        assert_eq!(ss.unique_intervals, vec![50]);
    }

    #[test]
    fn state_space_positions_start_at_zero() {
        let ss = BeatStateSpace::new(100.0, 120.0, 100.0);
        for &first in &ss.first_states {
            assert!((ss.positions[first] - 0.0).abs() < 1e-10);
        }
    }

    #[test]
    fn state_space_positions_below_one() {
        let ss = BeatStateSpace::new(55.0, 215.0, 100.0);
        for &p in &ss.positions {
            assert!(p >= 0.0);
            assert!(p < 1.0);
        }
    }

    #[test]
    fn state_space_multiple_tempi() {
        // 100–110 BPM at 100fps:
        //   min_interval = round(60*100/110) = 55
        //   max_interval = round(60*100/100) = 60
        //   intervals: 55, 56, 57, 58, 59, 60 → 6 tempi
        let ss = BeatStateSpace::new(100.0, 110.0, 100.0);
        assert_eq!(ss.num_tempi(), 6);
        // total states = 55+56+57+58+59+60 = 345
        assert_eq!(ss.num_states(), 345);
    }

    // -- Transition model --

    #[test]
    fn within_beat_transitions_are_deterministic() {
        let ss = BeatStateSpace::new(120.0, 120.0, 100.0);
        let tm = TransitionModel::new(&ss, 100.0);

        // States 1..49 should each have exactly one source (the previous state)
        for s in 1..50 {
            let start = tm.pointers[s];
            let end = tm.pointers[s + 1];
            assert_eq!(end - start, 1, "state {s} should have 1 predecessor");
            assert_eq!(tm.sources[start], (s - 1) as u32);
            assert!((tm.log_probs[start] - 0.0).abs() < 1e-10, "log(1.0) = 0.0");
        }
    }

    #[test]
    fn beat_boundary_transitions_normalized() {
        let ss = BeatStateSpace::new(100.0, 120.0, 100.0);
        let tm = TransitionModel::new(&ss, 100.0);

        // Each first_state receives transitions from all last_states.
        // The raw probabilities from each source tempo should sum to 1
        // (before log), so we check that exp(log_probs) for each source
        // tempo across all destination tempi sums to ~1.

        // For each source tempo, collect outgoing transition probs
        let n_tempi = ss.num_tempi();
        for src_idx in 0..n_tempi {
            let mut total = 0.0_f64;
            for dest_idx in 0..n_tempi {
                let dest = ss.first_states[dest_idx];
                let start = tm.pointers[dest];
                let end = tm.pointers[dest + 1];
                // Find the entry from src_idx
                for i in start..end {
                    if tm.sources[i] == ss.last_states[src_idx] as u32 {
                        total += tm.log_probs[i].exp();
                    }
                }
            }
            assert!(
                (total - 1.0).abs() < 1e-6,
                "source tempo {src_idx}: transition probs sum to {total}, expected 1.0"
            );
        }
    }

    #[test]
    fn same_tempo_preferred() {
        let ss = BeatStateSpace::new(100.0, 120.0, 100.0);
        let tm = TransitionModel::new(&ss, 100.0);

        // For a first_state at some tempo, the self-transition (same tempo)
        // should have the highest probability.
        for tempo_idx in 0..ss.num_tempi() {
            let dest = ss.first_states[tempo_idx];
            let start = tm.pointers[dest];
            let end = tm.pointers[dest + 1];

            let self_src = ss.last_states[tempo_idx] as u32;
            let mut self_lp = f64::NEG_INFINITY;
            let mut max_lp = f64::NEG_INFINITY;

            for i in start..end {
                if tm.sources[i] == self_src {
                    self_lp = tm.log_probs[i];
                }
                if tm.log_probs[i] > max_lp {
                    max_lp = tm.log_probs[i];
                }
            }

            assert!(
                (self_lp - max_lp).abs() < 1e-10,
                "tempo {tempo_idx}: self-transition should be highest prob"
            );
        }
    }

    // -- Observation model --

    #[test]
    fn observation_beat_states() {
        let ss = BeatStateSpace::new(120.0, 120.0, 100.0);
        let om = ObservationModel::new(&ss, 16.0);

        // interval=50, threshold=1/16=0.0625
        // positions 0/50=0.0, 1/50=0.02, 2/50=0.04 are < 0.0625 → beat
        // position 3/50=0.06 is < 0.0625 → beat
        // position 4/50=0.08 is >= 0.0625 → non-beat
        let beat_count = om.pointers.iter().filter(|&&p| p == 1).count();
        // floor(50 * 0.0625) = 3, so positions 0,1,2 → 3 beat states
        assert!(beat_count >= 3 && beat_count <= 4);
    }

    #[test]
    fn observation_densities() {
        let ss = BeatStateSpace::new(120.0, 120.0, 100.0);
        let om = ObservationModel::new(&ss, 16.0);

        // High activation: beat density should be much higher than non-beat
        let a_high = 0.9;
        let beat_high = om.log_density_beat(a_high);
        let no_beat_high = om.log_density_no_beat(a_high);
        assert!(beat_high > no_beat_high);

        // The ratio between beat and non-beat density should increase
        // with activation — high activation strongly favors beat states
        let a_low = 0.1;
        let beat_low = om.log_density_beat(a_low);
        let no_beat_low = om.log_density_no_beat(a_low);
        let ratio_high = beat_high - no_beat_high; // log ratio
        let ratio_low = beat_low - no_beat_low;
        assert!(
            ratio_high > ratio_low,
            "high activation should more strongly favor beats"
        );

        // At activation=0.5, beat and non-beat should be roughly equal
        // beat: ln(0.5) = -0.693, non-beat: ln(0.5/15) = -3.40
        // Actually beat is still higher because non-beat divides by (lambda-1).
        // This is correct: the Viterbi uses position constraints (only 1/16
        // of states are beat states) to prevent marking everything as a beat.
        let a_mid = 0.5;
        let beat_mid = om.log_density_beat(a_mid);
        let no_beat_mid = om.log_density_no_beat(a_mid);
        assert!(beat_mid > no_beat_mid);
    }

    // -- Viterbi on synthetic signals --

    fn make_pulse_signal(bpm: f64, fps: f64, duration_secs: f64) -> Vec<f64> {
        let n_frames = (duration_secs * fps) as usize;
        let interval = 60.0 * fps / bpm;
        let mut signal = vec![0.05; n_frames]; // low background
        let mut pos = 0.0_f64;
        while (pos as usize) < n_frames {
            let i = pos.round() as usize;
            if i < n_frames {
                signal[i] = 0.95;
                // Slight spread around the beat
                if i > 0 {
                    signal[i - 1] = 0.3;
                }
                if i + 1 < n_frames {
                    signal[i + 1] = 0.3;
                }
            }
            pos += interval;
        }
        signal
    }

    #[test]
    fn viterbi_finds_clean_120bpm() {
        let fps = 100.0;
        let signal = make_pulse_signal(120.0, fps, 10.0);
        let result = track_beats(&signal, &BeatTrackerParams::default());

        // Should find ~20 beats in 10s at 120 BPM
        assert!(
            result.beats.len() >= 18 && result.beats.len() <= 22,
            "expected ~20 beats, got {}",
            result.beats.len()
        );

        // BPM should be close to 120
        assert!(
            (result.bpm - 120.0).abs() < 2.0,
            "expected ~120 BPM, got {:.1}",
            result.bpm
        );
    }

    #[test]
    fn viterbi_finds_clean_90bpm() {
        let fps = 100.0;
        let signal = make_pulse_signal(90.0, fps, 10.0);
        let result = track_beats(&signal, &BeatTrackerParams::default());

        // ~15 beats in 10s at 90 BPM
        assert!(
            result.beats.len() >= 13 && result.beats.len() <= 17,
            "expected ~15 beats, got {}",
            result.beats.len()
        );

        assert!(
            (result.bpm - 90.0).abs() < 2.0,
            "expected ~90 BPM, got {:.1}",
            result.bpm
        );
    }

    #[test]
    fn viterbi_robust_to_noise() {
        let fps = 100.0;
        let mut signal = make_pulse_signal(120.0, fps, 10.0);

        // Add noise: random-ish bumps (deterministic for reproducibility)
        for (i, v) in signal.iter_mut().enumerate() {
            let noise = ((i as f64 * 7.3).sin() * 0.15).abs();
            *v = (*v + noise).min(1.0);
        }

        let result = track_beats(&signal, &BeatTrackerParams::default());

        assert!(
            result.beats.len() >= 17 && result.beats.len() <= 23,
            "expected ~20 beats with noise, got {}",
            result.beats.len()
        );

        assert!(
            (result.bpm - 120.0).abs() < 5.0,
            "expected ~120 BPM with noise, got {:.1}",
            result.bpm
        );
    }

    #[test]
    fn viterbi_handles_tempo_ramp() {
        // Signal that ramps from 100 to 120 BPM over 10 seconds.
        let fps = 100.0;
        let duration = 10.0;
        let n_frames = (duration * fps) as usize;
        let mut signal = vec![0.05; n_frames];

        let mut time = 0.0;
        while time < duration {
            // Linearly interpolate BPM from 100 to 120
            let frac = time / duration;
            let bpm = 100.0 + 20.0 * frac;
            let i = (time * fps) as usize;
            if i < n_frames {
                signal[i] = 0.95;
                if i > 0 { signal[i - 1] = 0.3; }
                if i + 1 < n_frames { signal[i + 1] = 0.3; }
            }
            time += 60.0 / bpm;
        }

        let params = BeatTrackerParams {
            transition_lambda: 20.0, // more lenient for tempo changes
            ..Default::default()
        };
        let result = track_beats(&signal, &params);

        // Should find roughly the right number of beats
        // (average ~110 BPM over 10s ≈ 18-19 beats)
        assert!(
            result.beats.len() >= 15 && result.beats.len() <= 23,
            "expected ~18 beats in tempo ramp, got {}",
            result.beats.len()
        );

        // BPM should be somewhere in the 100-120 range
        assert!(
            result.bpm >= 95.0 && result.bpm <= 125.0,
            "expected BPM in 100-120 range, got {:.1}",
            result.bpm
        );
    }

    #[test]
    fn empty_activation_returns_no_beats() {
        let result = track_beats(&[], &BeatTrackerParams::default());
        assert!(result.beats.is_empty());
        assert_eq!(result.bpm, 0.0);
    }
}
