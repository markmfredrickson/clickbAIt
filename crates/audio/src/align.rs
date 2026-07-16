//! Forced alignment of known lyrics to vocal audio.
//!
//! Loads wav2vec2-base-960h (ONNX) via `ort`, runs CTC forced alignment against
//! a target transcript, and emits word-level timings. Unlike `transcribe`
//! (Whisper), this cannot hallucinate — it maps the provided text onto the
//! audio and tells you where each character was uttered.

use anyhow::{anyhow, bail, Context, Result};
use ort::session::Session;
use ort::value::Tensor;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::analyze::decode_audio;

const MODEL_REPO: &str =
    "https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main";
const TARGET_SR: u32 = 16_000;
// wav2vec2-base has a 320-sample stride at 16kHz = 20ms per frame.
const FRAME_MS: f64 = 20.0;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlignedChar {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub confidence: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlignedWord {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub confidence: f64,
    pub chars: Vec<AlignedChar>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlignedLine {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub word_range: (usize, usize),
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlignResult {
    pub words: Vec<AlignedWord>,
    pub lines: Vec<AlignedLine>,
}

fn cache_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    let p = PathBuf::from(home)
        .join(".cache")
        .join("clickbait")
        .join("models")
        .join("wav2vec2-base-960h");
    fs::create_dir_all(&p).ok();
    Ok(p)
}

fn download(url: &str, dest: &Path) -> Result<()> {
    if dest.exists() {
        return Ok(());
    }
    eprintln!("downloading {url}");
    let resp = reqwest::blocking::get(url)?;
    if !resp.status().is_success() {
        bail!("download failed ({}): {url}", resp.status());
    }
    let bytes = resp.bytes()?;
    fs::write(dest, &bytes)?;
    eprintln!("  -> {} ({} bytes)", dest.display(), bytes.len());
    Ok(())
}

fn ensure_model() -> Result<(PathBuf, PathBuf)> {
    let dir = cache_dir()?;
    let model = dir.join("model.onnx");
    let vocab = dir.join("vocab.json");
    download(&format!("{MODEL_REPO}/onnx/model.onnx"), &model)?;
    download(&format!("{MODEL_REPO}/vocab.json"), &vocab)?;
    Ok((model, vocab))
}

struct Vocab {
    char_to_id: HashMap<char, i64>,
    id_to_char: HashMap<i64, char>,
    blank_id: i64,
    word_delim_id: i64,
}

fn load_vocab(path: &Path) -> Result<Vocab> {
    let s = fs::read_to_string(path)?;
    let m: HashMap<String, i64> = serde_json::from_str(&s)?;
    let mut char_to_id = HashMap::new();
    let mut id_to_char = HashMap::new();
    let mut blank_id = 0;
    let mut word_delim_id = -1;
    for (k, v) in &m {
        match k.as_str() {
            "<pad>" => blank_id = *v,
            "|" => word_delim_id = *v,
            s if s.chars().count() == 1 && !s.starts_with('<') => {
                let c = s.chars().next().unwrap();
                char_to_id.insert(c, *v);
                id_to_char.insert(*v, c);
            }
            _ => {}
        }
    }
    if word_delim_id < 0 {
        bail!("vocab.json missing word delimiter '|'");
    }
    Ok(Vocab { char_to_id, id_to_char, blank_id, word_delim_id })
}

fn resample_to_16k(samples: Vec<f32>, from_sr: u32) -> Result<Vec<f32>> {
    if from_sr == TARGET_SR {
        return Ok(samples);
    }
    use rubato::{FftFixedIn, Resampler};
    let ratio = TARGET_SR as usize;
    let chunk = 4096;
    let mut r = FftFixedIn::<f32>::new(from_sr as usize, ratio, chunk, 2, 1)?;
    let mut out: Vec<f32> = Vec::new();
    let mut pos = 0;
    while pos + chunk <= samples.len() {
        let buf = vec![samples[pos..pos + chunk].to_vec()];
        let res = r.process(&buf, None)?;
        out.extend(&res[0]);
        pos += chunk;
    }
    // pad+finish remainder
    if pos < samples.len() {
        let mut last = vec![0.0f32; chunk];
        last[..samples.len() - pos].copy_from_slice(&samples[pos..]);
        let res = r.process(&[last], None)?;
        out.extend(&res[0]);
    }
    Ok(out)
}

/// Normalize text to wav2vec2-base-960h's vocab domain:
/// uppercase, keep A–Z and apostrophe, everything else → space.
fn normalize_text(text: &str) -> String {
    let mut out = String::new();
    let mut prev_space = true;
    for c in text.chars() {
        if c.is_ascii_alphabetic() {
            out.push(c.to_ascii_uppercase());
            prev_space = false;
        } else if c == '\'' {
            out.push('\'');
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    out.trim().to_string()
}

/// Build the per-position token sequence. Returns parallel vectors of
/// (vocab_id, source_char). Word delimiter uses `' '` as source_char.
fn tokenize(norm: &str, vocab: &Vocab) -> (Vec<i64>, Vec<char>) {
    let mut ids = Vec::new();
    let mut chars = Vec::new();
    for c in norm.chars() {
        if c == ' ' {
            ids.push(vocab.word_delim_id);
            chars.push(' ');
        } else if let Some(&id) = vocab.char_to_id.get(&c) {
            ids.push(id);
            chars.push(c);
        }
        // else: char unknown to vocab — skip silently
    }
    (ids, chars)
}

/// CTC forced alignment via Viterbi on an extended target sequence.
///
/// The extended target interleaves blanks: `[⊘, c1, ⊘, c2, ⊘, ..., cn, ⊘]`.
/// Transitions at each frame: stay (s→s), advance (s→s+1), or skip-blank
/// (s→s+2, only when the blank at s+1 is between two distinct non-blank chars).
///
/// Returns, for each target char, (start_frame, end_frame) inclusive.
fn forced_align(
    log_probs: &[Vec<f32>],
    target_ids: &[i64],
    blank_id: i64,
) -> Result<Vec<(usize, usize)>> {
    let t_frames = log_probs.len();
    if target_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Extended target
    let mut ext: Vec<i64> = Vec::with_capacity(2 * target_ids.len() + 1);
    ext.push(blank_id);
    for &c in target_ids {
        ext.push(c);
        ext.push(blank_id);
    }
    let s_states = ext.len();
    if s_states > t_frames {
        bail!(
            "target too long for audio: {} states vs {} frames",
            s_states,
            t_frames
        );
    }

    let neg_inf = f32::NEG_INFINITY;
    let mut tr = vec![vec![neg_inf; t_frames]; s_states];
    let mut back = vec![vec![0u8; t_frames]; s_states];

    // Init: can start at state 0 (blank) or 1 (first char)
    tr[0][0] = log_probs[0][ext[0] as usize];
    if s_states > 1 {
        tr[1][0] = log_probs[0][ext[1] as usize];
    }

    for ti in 1..t_frames {
        for si in 0..s_states {
            let emit = log_probs[ti][ext[si] as usize];
            let mut best = tr[si][ti - 1]; // stay
            let mut bk = 0u8;
            if si >= 1 {
                let cand = tr[si - 1][ti - 1];
                if cand > best {
                    best = cand;
                    bk = 1;
                }
            }
            if si >= 2 && ext[si] != blank_id && ext[si - 2] != ext[si] {
                let cand = tr[si - 2][ti - 1];
                if cand > best {
                    best = cand;
                    bk = 2;
                }
            }
            tr[si][ti] = best + emit;
            back[si][ti] = bk;
        }
    }

    // Backtrack from the better of the two final states (blank or last char)
    let mut si = s_states - 1;
    if s_states >= 2 && tr[s_states - 2][t_frames - 1] > tr[s_states - 1][t_frames - 1] {
        si = s_states - 2;
    }
    let mut ti = t_frames - 1;
    let mut path = vec![0usize; t_frames];
    path[ti] = si;
    while ti > 0 {
        let step = back[si][ti] as usize;
        si = si.saturating_sub(step);
        ti -= 1;
        path[ti] = si;
    }

    // Extract (first,last) frame per target-char state (odd indices in ext).
    let mut spans: Vec<(usize, usize)> = vec![(usize::MAX, 0); target_ids.len()];
    for (frame, &state) in path.iter().enumerate() {
        if state % 2 == 1 {
            let char_idx = state / 2;
            if spans[char_idx].0 == usize::MAX {
                spans[char_idx].0 = frame;
            }
            spans[char_idx].1 = frame;
        }
    }
    // Any char never emitted (e.g., fully absorbed by blanks) — fallback to
    // nearest emitted neighbor. Rare in practice for well-formed inputs.
    for i in 0..spans.len() {
        if spans[i].0 == usize::MAX {
            let prev = (0..i).rev().find(|&j| spans[j].0 != usize::MAX);
            let next = ((i + 1)..spans.len()).find(|&j| spans[j].0 != usize::MAX);
            match (prev, next) {
                (Some(p), _) => spans[i] = (spans[p].1, spans[p].1),
                (None, Some(n)) => spans[i] = (spans[n].0, spans[n].0),
                _ => spans[i] = (0, 0),
            }
        }
    }
    Ok(spans)
}

fn frame_to_ms(frame: usize) -> u64 {
    (frame as f64 * FRAME_MS) as u64
}

/// How many leading (near-)silent samples to trim before alignment.
///
/// A long silent or instrumental intro on the vocal stem gives CTC nothing to
/// anchor the first words to, so forced alignment spreads them into the silence
/// and the first sung word latches onto a spurious early onset. Trimming the
/// lead removes the empty runway; the caller adds the trimmed offset back to
/// every timestamp, so the result stays in the file's own time frame.
///
/// Detects the first frame of energy that STAYS up (a sustained vocal entry,
/// not a click), then backs off a lead-in margin so the attack is never
/// clipped. Returns 0 when the audio starts hot or is silent throughout — in
/// both cases trimming would do no good, so it's a no-op.
fn leading_silence_samples(samples: &[f32], sr: u32) -> usize {
    if samples.is_empty() {
        return 0;
    }
    let win = (sr as usize / 50).max(1); // ~20ms frames
    let mut rms: Vec<f32> = Vec::new();
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
    let peak = rms.iter().cloned().fold(0.0f32, f32::max);
    if peak <= 0.0 {
        return 0;
    }
    // Onset = a fraction of the loudest frame, floored so a merely-quiet intro
    // isn't over-trimmed; sustained over several frames so a stray click in the
    // intro doesn't count as the vocal entry.
    let thresh = (peak * 0.08).max(1e-3);
    let sustain = 5usize; // ~100ms
    let mut onset_frame = None;
    for f in 0..rms.len() {
        if rms[f] >= thresh {
            let hold = (f..(f + sustain).min(rms.len())).all(|k| rms[k] >= thresh);
            if hold {
                onset_frame = Some(f);
                break;
            }
        }
    }
    let onset_sample = match onset_frame {
        Some(f) => f * win,
        None => return 0,
    };
    let lead_in = (sr as usize * 250) / 1000; // keep 250ms before the attack
    onset_sample.saturating_sub(lead_in)
}

/// Log-softmax a logits row in place-returning form.
fn log_softmax(row: &[f32]) -> Vec<f32> {
    let m = row.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let s: f32 = row.iter().map(|x| (x - m).exp()).sum();
    let log_sum = m + s.ln();
    row.iter().map(|x| x - log_sum).collect()
}

pub fn run(file: &str, text_arg: &str, output: Option<&str>, trim_silence: bool) -> Result<()> {
    let (model_path, vocab_path) = ensure_model()?;
    let vocab = load_vocab(&vocab_path)?;

    // Target text may be a file path or a literal string.
    let raw_text = if Path::new(text_arg).exists() {
        fs::read_to_string(text_arg)?
    } else {
        text_arg.to_string()
    };
    // Line tracking: record which target-char indices correspond to each line.
    let lines_raw: Vec<&str> = raw_text.lines().collect();

    let norm = normalize_text(&raw_text);
    let (target_ids, target_chars) = tokenize(&norm, &vocab);
    if target_ids.is_empty() {
        bail!("target text produced no tokens after normalization");
    }
    eprintln!(
        "target: {} chars, {} tokens ({} word delims)",
        norm.chars().count(),
        target_ids.len(),
        target_ids.iter().filter(|&&t| t == vocab.word_delim_id).count()
    );

    // Load & resample audio.
    let (samples, sr) = decode_audio(file)?;
    eprintln!(
        "audio: {} samples @ {}Hz = {:.2}s",
        samples.len(),
        sr,
        samples.len() as f64 / sr as f64
    );
    let audio16k = resample_to_16k(samples, sr)?;
    eprintln!(
        "resampled: {} samples @ 16kHz = {:.2}s",
        audio16k.len(),
        audio16k.len() as f64 / 16_000.0
    );

    // Trim a silent/instrumental lead so CTC anchors the first words to real
    // vocal, not the empty intro. The trimmed offset is added back to every
    // timestamp below, so the emitted times stay in the file's own frame.
    let trim_samples = if trim_silence {
        leading_silence_samples(&audio16k, TARGET_SR)
    } else {
        0
    };
    let offset_ms = (trim_samples as f64 / TARGET_SR as f64 * 1000.0) as u64;
    let audio16k = if trim_samples > 0 {
        eprintln!(
            "trimmed {:.2}s leading silence before alignment (offset added back to timestamps)",
            offset_ms as f64 / 1000.0
        );
        audio16k[trim_samples..].to_vec()
    } else {
        audio16k
    };

    // Load ONNX session.
    let mut session = Session::builder()?
        .with_intra_threads(4)?
        .commit_from_file(&model_path)?;

    // Chunked inference. wav2vec2 has O(n²) self-attention in the encoder, so
    // a full 5-minute song (~15 k frames) will OOM on one shot. Run in
    // overlapping windows, drop the per-window edge frames to avoid boundary
    // effects, and concatenate the per-frame log-probs.
    //
    // At 16 kHz: 30 s chunk = 480 000 samples → ~1500 frames. With 2 s overlap
    // we keep the middle 28 s (1400 frames) of each chunk after the first.
    const CHUNK_S: usize = 30;
    const OVERLAP_S: usize = 2;
    const CHUNK_SAMPLES: usize = CHUNK_S * TARGET_SR as usize;
    const STEP_SAMPLES: usize = (CHUNK_S - OVERLAP_S) * TARGET_SR as usize;
    // Frame-rate ≈ 50 fps (20 ms stride). Keep this in sync with FRAME_MS.
    const DROP_FRAMES_EDGE: usize = OVERLAP_S * 1000 / FRAME_MS as usize / 2;

    let mut log_probs: Vec<Vec<f32>> = Vec::new();
    let mut pos = 0usize;
    let mut chunk_idx = 0usize;
    let total = audio16k.len();
    while pos < total {
        let end = (pos + CHUNK_SAMPLES).min(total);
        let mut buf: Vec<f32> = audio16k[pos..end].to_vec();
        // Pad short final chunk to model-friendly length (not required for dynamic axes
        // but avoids pathological short inputs). Skip if already long enough.
        if buf.len() < 16 * TARGET_SR as usize / 1000 * 100 {
            buf.resize((16 * TARGET_SR as usize / 1000 * 100).min(CHUNK_SAMPLES), 0.0);
        }
        let nsamples = buf.len();
        eprintln!(
            "chunk {}: {:.2}-{:.2}s ({} samples)",
            chunk_idx,
            pos as f64 / TARGET_SR as f64,
            (pos + nsamples) as f64 / TARGET_SR as f64,
            nsamples
        );
        let input = Tensor::<f32>::from_array((
            vec![1_i64, nsamples as i64],
            buf.into_boxed_slice(),
        ))?;
        let outputs = session.run(ort::inputs![input])?;
        let (shape_ref, logits) = outputs[0].try_extract_tensor::<f32>()?;
        let dims: Vec<i64> = shape_ref.as_ref().iter().copied().collect();
        if dims.len() != 3 || dims[0] != 1 {
            bail!("unexpected logits shape {:?}, want [1, T, V]", dims);
        }
        let n_frames = dims[1] as usize;
        let vocab_size = dims[2] as usize;

        // Decide which frames from this chunk to keep:
        //   - first chunk: keep [0, n_frames - drop_right)
        //   - last chunk: keep [drop_left, n_frames)
        //   - middle:     keep [drop_left, n_frames - drop_right)
        let is_first = chunk_idx == 0;
        let is_last = end >= total;
        let drop_left = if is_first { 0 } else { DROP_FRAMES_EDGE };
        let drop_right = if is_last { 0 } else { DROP_FRAMES_EDGE };
        let f_start = drop_left;
        let f_end = n_frames.saturating_sub(drop_right);
        for f in f_start..f_end {
            let row = &logits[f * vocab_size..(f + 1) * vocab_size];
            log_probs.push(log_softmax(row));
        }

        if is_last {
            break;
        }
        pos += STEP_SAMPLES;
        chunk_idx += 1;
    }
    eprintln!("total frames: {}", log_probs.len());

    let spans = forced_align(&log_probs, &target_ids, vocab.blank_id)?;

    // Build words from the char spans.
    let mut words: Vec<AlignedWord> = Vec::new();
    let mut cur_chars: Vec<AlignedChar> = Vec::new();
    let mut cur_text = String::new();
    for (i, &tid) in target_ids.iter().enumerate() {
        if tid == vocab.word_delim_id {
            if !cur_chars.is_empty() {
                let first = cur_chars.first().unwrap();
                let last = cur_chars.last().unwrap();
                words.push(AlignedWord {
                    text: cur_text.clone(),
                    start_ms: first.start_ms,
                    end_ms: last.end_ms,
                    confidence: 1.0,
                    chars: std::mem::take(&mut cur_chars),
                });
                cur_text.clear();
            }
        } else {
            let (sf, ef) = spans[i];
            let ch = target_chars[i];
            cur_chars.push(AlignedChar {
                text: ch.to_string(),
                start_ms: frame_to_ms(sf),
                end_ms: frame_to_ms(ef.saturating_add(1)),
                confidence: 1.0,
            });
            cur_text.push(ch);
        }
    }
    if !cur_chars.is_empty() {
        let first = cur_chars.first().unwrap();
        let last = cur_chars.last().unwrap();
        words.push(AlignedWord {
            text: cur_text.clone(),
            start_ms: first.start_ms,
            end_ms: last.end_ms,
            confidence: 1.0,
            chars: cur_chars,
        });
    }

    // Put timestamps back into the file's frame (undo the leading-silence trim).
    // Done before line spans are built so lines inherit the corrected word times.
    if offset_ms > 0 {
        for w in &mut words {
            w.start_ms += offset_ms;
            w.end_ms += offset_ms;
            for c in &mut w.chars {
                c.start_ms += offset_ms;
                c.end_ms += offset_ms;
            }
        }
    }

    // Build line spans by matching line text (normalized) back to word order.
    let mut lines_out: Vec<AlignedLine> = Vec::new();
    let mut word_cursor = 0usize;
    for line in &lines_raw {
        let ln_norm = normalize_text(line);
        if ln_norm.is_empty() {
            continue;
        }
        let line_word_count = ln_norm.split_whitespace().count();
        let end = (word_cursor + line_word_count).min(words.len());
        if end > word_cursor {
            let start_ms = words[word_cursor].start_ms;
            let end_ms = words[end - 1].end_ms;
            lines_out.push(AlignedLine {
                text: line.to_string(),
                start_ms,
                end_ms,
                word_range: (word_cursor, end),
            });
            word_cursor = end;
        }
    }

    let result = AlignResult { words, lines: lines_out };
    let json = serde_json::to_string_pretty(&result)?;
    let out_path: PathBuf = match output {
        Some(p) => PathBuf::from(p),
        None => {
            let p = Path::new(file);
            let parent = p.parent().unwrap_or(Path::new("."));
            let stem = p
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| anyhow!("bad file path"))?;
            parent.join(format!("{stem}.align.json"))
        }
    };
    fs::write(&out_path, &json)?;
    eprintln!("wrote: {}", out_path.display());
    println!("{json}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_basic() {
        assert_eq!(normalize_text("Hello, world!"), "HELLO WORLD");
        assert_eq!(normalize_text("  don't  stop "), "DON'T STOP");
        assert_eq!(normalize_text("A B  C"), "A B C");
    }

    // A tone frame (loud) and a silent frame at 16kHz, for building fixtures.
    fn tone(n: usize) -> Vec<f32> {
        (0..n).map(|i| (i as f32 * 0.3).sin() * 0.5).collect()
    }
    fn silence(n: usize) -> Vec<f32> {
        vec![0.0; n]
    }
    const SR: u32 = 16_000;
    const LEAD_IN: usize = SR as usize * 250 / 1000; // 250ms

    #[test]
    fn trim_silence_then_tone() {
        // 1s silence, then a tone. Onset ~ sample 16000; trim = onset - lead-in.
        let mut s = silence(SR as usize);
        s.extend(tone(SR as usize));
        let trimmed = leading_silence_samples(&s, SR);
        // Within a couple of frames of (onset - lead_in).
        let expected = SR as usize - LEAD_IN;
        assert!(
            (trimmed as isize - expected as isize).abs() < (SR as isize / 25),
            "trimmed {trimmed}, expected ~{expected}"
        );
    }

    #[test]
    fn trim_hot_start_is_noop() {
        // Tone from the first sample: onset is at 0, lead-in clamps to 0.
        let s = tone(SR as usize);
        assert_eq!(leading_silence_samples(&s, SR), 0);
    }

    #[test]
    fn trim_all_silence_is_noop() {
        let s = silence(SR as usize * 2);
        assert_eq!(leading_silence_samples(&s, SR), 0);
    }

    #[test]
    fn trim_ignores_a_click_in_the_intro() {
        // Silence, a 20ms click, more silence, then the real (sustained) entry.
        let mut s = silence(SR as usize / 2);
        s.extend(tone(SR as usize / 50)); // ~20ms click (< sustain window)
        s.extend(silence(SR as usize / 2));
        let real_onset = s.len();
        s.extend(tone(SR as usize));
        let trimmed = leading_silence_samples(&s, SR);
        // Should trim toward the real onset, not the click half a second earlier.
        let expected = real_onset - LEAD_IN;
        assert!(
            (trimmed as isize - expected as isize).abs() < (SR as isize / 25),
            "trimmed {trimmed}, expected ~{expected} (should skip the click)"
        );
    }

    #[test]
    fn trim_never_exceeds_onset_when_onset_is_early() {
        // Onset closer than the lead-in margin -> clamps to 0, never past it.
        let mut s = silence(SR as usize / 20); // 50ms < 250ms lead-in
        s.extend(tone(SR as usize));
        assert_eq!(leading_silence_samples(&s, SR), 0);
    }

    #[test]
    fn forced_align_trivial() {
        // vocab: {blank:0, A:1, B:2}; target "AB" → ext [0,1,0,2,0]; 5 frames
        // frames chosen so A dominates frames 0-1, B dominates 2-4.
        let blank = 0i64;
        let target = vec![1i64, 2];
        let ninf = f32::NEG_INFINITY;
        let lp = |bl: f32, a: f32, b: f32| vec![bl, a, b];
        let log_probs = vec![
            lp(-5.0, -0.1, -5.0),
            lp(-5.0, -0.1, -5.0),
            lp(-5.0, -5.0, -0.1),
            lp(-5.0, -5.0, -0.1),
            lp(-5.0, -5.0, -0.1),
        ];
        // sanity: prevent unused-var warnings
        let _ = ninf;
        let spans = forced_align(&log_probs, &target, blank).unwrap();
        assert_eq!(spans.len(), 2);
        assert!(spans[0].0 <= 1 && spans[0].1 <= 1, "A frames {:?}", spans[0]);
        assert!(spans[1].0 >= 2, "B starts {:?}", spans[1]);
    }
}
