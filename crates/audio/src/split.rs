use anyhow::{Context, Result};
use serde::Serialize;
use std::path::Path;

use demucs_core::listener::{ForwardEvent, ForwardListener};
use demucs_core::model::metadata::{HTDEMUCS, HTDEMUCS_6S, HTDEMUCS_FT};
use demucs_core::provider::fs::FsProvider;
use demucs_core::provider::ModelProvider;
use demucs_core::{Demucs, ModelOptions};

use crate::analyze::decode_stereo;

#[cfg(feature = "gpu")]
type B = burn::backend::wgpu::Wgpu;
#[cfg(all(feature = "cpu", not(feature = "gpu")))]
type B = burn::backend::NdArray<f32>;

#[derive(Debug, Clone, Copy)]
pub enum Model {
    FourStem,
    SixStem,
    FineTuned,
}

impl Model {
    pub fn from_str(s: &str) -> Result<Self> {
        match s {
            "4stem" => Ok(Model::FourStem),
            "6stem" => Ok(Model::SixStem),
            "finetune" => Ok(Model::FineTuned),
            _ => anyhow::bail!("Unknown model: {s}. Expected: 4stem, 6stem, finetune"),
        }
    }

    fn model_options(&self) -> ModelOptions {
        match self {
            Model::FourStem => ModelOptions::FourStem,
            Model::SixStem => ModelOptions::SixStem,
            Model::FineTuned => ModelOptions::FineTuned(vec![]),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitResult {
    pub stems: Vec<StemOutput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StemOutput {
    pub name: String,
    pub path: String,
}

struct ProgressListener;

impl ForwardListener for ProgressListener {
    fn on_event(&mut self, event: ForwardEvent) {
        match event {
            ForwardEvent::ChunkStarted { index, total } => {
                eprintln!("Processing chunk {}/{}...", index + 1, total);
            }
            ForwardEvent::ChunkDone { index, total } => {
                eprintln!("Chunk {}/{} done", index + 1, total);
            }
            ForwardEvent::StemDone { index, total } => {
                eprintln!("Stem {}/{} extracted", index + 1, total);
            }
            _ => {}
        }
    }
}

/// Write stereo f32 samples to a WAV file (44100 Hz, 16-bit).
pub fn write_stereo_wav(path: &Path, left: &[f32], right: &[f32], sample_rate: u32) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(path, spec)
        .with_context(|| format!("Failed to create WAV file: {}", path.display()))?;

    for (&l, &r) in left.iter().zip(right.iter()) {
        let l16 = (l.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        let r16 = (r.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(l16)?;
        writer.write_sample(r16)?;
    }

    writer.finalize()?;
    Ok(())
}

/// Download model weights if not cached, return bytes.
fn load_model_weights(model: Model) -> Result<Vec<u8>> {
    let provider = FsProvider::new().context("Failed to initialize model cache")?;
    let info = match model {
        Model::FourStem => &HTDEMUCS,
        Model::SixStem => &HTDEMUCS_6S,
        Model::FineTuned => &HTDEMUCS_FT,
    };

    if provider.is_cached(info) {
        eprintln!("Loading cached model: {}", info.label);
        return provider
            .load_cached(info)
            .map_err(|e| anyhow::anyhow!("{e}"));
    }

    eprintln!("Downloading model: {} ({} MB)...", info.label, info.size_mb);
    let url = demucs_core::model::metadata::download_url(info);
    let response = reqwest::blocking::get(&url)
        .with_context(|| format!("Failed to download model from {url}"))?;
    let bytes = response
        .bytes()
        .context("Failed to read model response")?
        .to_vec();

    provider
        .cache_model(info, &bytes)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    eprintln!("Model cached.");

    Ok(bytes)
}

pub fn run(file: &str, output_dir: &str, model_name: &str) -> Result<()> {
    let model = Model::from_str(model_name)?;

    // Decode audio to stereo
    eprintln!("Decoding {}...", file);
    let (left, right, sample_rate) = decode_stereo(file)?;
    let duration = left.len() as f64 / sample_rate as f64;
    eprintln!(
        "Decoded: {} samples/ch, {}Hz, {:.1}s",
        left.len(),
        sample_rate,
        duration,
    );

    // Load model
    let weights = load_model_weights(model)?;
    let device = Default::default();
    let demucs = Demucs::<B>::from_bytes(model.model_options(), &weights, device)
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    // Warm up GPU shaders on first run
    #[cfg(feature = "gpu")]
    {
        eprintln!("Warming up GPU...");
        pollster::block_on(demucs.warmup());
    }

    // Separate
    eprintln!("Separating stems...");
    let mut listener = ProgressListener;
    let stems = pollster::block_on(
        demucs.separate_with_listener(&left, &right, sample_rate, &mut listener),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    // Write output
    let out_path = Path::new(output_dir);
    std::fs::create_dir_all(out_path)
        .with_context(|| format!("Failed to create output dir: {output_dir}"))?;

    let input_stem = Path::new(file)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let mut result = SplitResult { stems: Vec::new() };

    for stem in &stems {
        let filename = format!("{}_{}.wav", input_stem, stem.id.as_str());
        let stem_path = out_path.join(&filename);
        eprintln!("Writing {}...", filename);
        write_stereo_wav(&stem_path, &stem.left, &stem.right, sample_rate)?;
        result.stems.push(StemOutput {
            name: stem.id.as_str().to_string(),
            path: stem_path.to_string_lossy().to_string(),
        });
    }

    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_from_str() {
        assert!(matches!(Model::from_str("4stem").unwrap(), Model::FourStem));
        assert!(matches!(Model::from_str("6stem").unwrap(), Model::SixStem));
        assert!(matches!(
            Model::from_str("finetune").unwrap(),
            Model::FineTuned
        ));
        assert!(Model::from_str("bogus").is_err());
    }

    #[test]
    fn test_write_stereo_wav() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.wav");

        // 100 samples of a simple tone
        let sample_rate = 44100;
        let n = 100;
        let left: Vec<f32> = (0..n).map(|i| (i as f32 / n as f32 * 2.0 - 1.0) * 0.5).collect();
        let right: Vec<f32> = (0..n)
            .map(|i| ((i as f32 / n as f32) * std::f32::consts::PI * 4.0).sin() * 0.5)
            .collect();

        write_stereo_wav(&path, &left, &right, sample_rate).unwrap();

        // Verify: file exists, is a valid WAV, has correct properties
        let reader = hound::WavReader::open(&path).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.channels, 2);
        assert_eq!(spec.sample_rate, 44100);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(reader.len() as usize, n * 2); // interleaved L+R samples
    }

    #[test]
    fn test_write_stereo_wav_clamps() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clamp.wav");

        // Values outside -1..1 should be clamped
        let left = vec![2.0_f32, -2.0, 0.0];
        let right = vec![-3.0_f32, 3.0, 0.5];

        write_stereo_wav(&path, &left, &right, 44100).unwrap();

        let mut reader = hound::WavReader::open(&path).unwrap();
        let samples: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        // L=2.0 clamped to 1.0 -> i16::MAX
        assert_eq!(samples[0], i16::MAX);
        // R=-3.0 clamped to -1.0 -> -i16::MAX (not i16::MIN due to asymmetry)
        assert_eq!(samples[1], -i16::MAX);
    }

    #[test]
    fn test_decode_stereo_wav() {
        // Create a test WAV file
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stereo_test.wav");

        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        // Write 10 frames of stereo: left=0.5, right=-0.5
        for _ in 0..10 {
            writer.write_sample((0.5_f32 * i16::MAX as f32) as i16).unwrap();
            writer.write_sample((-0.5_f32 * i16::MAX as f32) as i16).unwrap();
        }
        writer.finalize().unwrap();

        let (left, right, sr) = decode_stereo(path.to_str().unwrap()).unwrap();
        assert_eq!(sr, 44100);
        assert_eq!(left.len(), 10);
        assert_eq!(right.len(), 10);
        // Check values are approximately correct (16-bit quantization)
        assert!((left[0] - 0.5).abs() < 0.001);
        assert!((right[0] + 0.5).abs() < 0.001);
    }

    #[test]
    #[ignore] // Requires model download (~84MB)
    fn test_split_integration() {
        // This test requires:
        // 1. A real audio file at the path below
        // 2. Internet access for model download on first run
        let test_file = "../../examples/all_the_small_things/Blink_182_All_the_Small_Things(Lead_Vocal_Custom_Backing_Track-3).mp3";
        if !Path::new(test_file).exists() {
            eprintln!("Skipping integration test: test file not found");
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let output_dir = dir.path().to_str().unwrap();

        run(test_file, output_dir, "6stem").unwrap();

        // Verify 6 stem files were created
        let expected_stems = ["vocals", "drums", "bass", "other", "guitar", "piano"];
        for stem_name in &expected_stems {
            let stem_file = dir.path().join(format!(
                "Blink_182_All_the_Small_Things(Lead_Vocal_Custom_Backing_Track-3)_{}.wav",
                stem_name
            ));
            assert!(
                stem_file.exists(),
                "Missing stem file: {}",
                stem_file.display()
            );
            let metadata = std::fs::metadata(&stem_file).unwrap();
            assert!(metadata.len() > 0, "Empty stem file: {}", stem_file.display());
        }
    }
}
