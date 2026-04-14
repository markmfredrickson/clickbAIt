use clap::{Parser, Subcommand};
use anyhow::Result;

mod activation;
mod analyze;
mod dbn;
mod lookup;
mod setup;
mod split;
mod transcribe;
mod speak;
mod unstretch;

#[derive(Parser)]
#[command(name = "clickbait-audio")]
#[command(about = "Audio analysis, transcription, and TTS for clickbAIt")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Get the duration of an audio file in seconds (WAV, MP3, etc.)
    Duration {
        /// Path to audio file
        file: String,
    },
    /// Extract BPM, key, and beat positions from an audio file (legacy)
    Analyze {
        /// Path to audio file
        file: String,
    },
    /// Detect beats using DBN beat tracker
    Beats {
        /// Path to audio file
        file: String,
        /// Activation function: energy (best for drums) or spectral-flux (for mix)
        #[arg(long, default_value = "energy")]
        activation: String,
        /// Minimum BPM to consider
        #[arg(long, default_value_t = 55.0)]
        min_bpm: f64,
        /// Maximum BPM to consider
        #[arg(long, default_value_t = 215.0)]
        max_bpm: f64,
    },
    /// Transcribe lyrics with word-level timestamps
    Transcribe {
        /// Path to audio file (ideally a vocal stem)
        file: String,
        /// Whisper model to use
        #[arg(long, default_value = "base.en")]
        model: String,
    },
    /// Look up song metadata from multiple sources
    Lookup {
        /// Song title
        title: String,
        /// Artist name (optional, improves accuracy)
        #[arg(short, long)]
        artist: Option<String>,
    },
    /// Detect tempo warping and estimate constant recording BPM
    Unstretch {
        /// Path to audio file
        file: String,
    },
    /// Separate audio into stems using Demucs
    Split {
        /// Path to audio file
        file: String,
        /// Output directory for stem WAV files
        #[arg(short, long, default_value = ".")]
        output_dir: String,
        /// Model variant: 4stem, 6stem, finetune
        #[arg(short, long, default_value = "6stem")]
        model: String,
    },
    /// Download required models (Whisper, Piper, Demucs) to ~/.cache/clickbait/
    Setup,
    /// Generate spoken audio from text (for cue tracks)
    Speak {
        /// Text to speak
        text: String,
        /// Output audio file
        #[arg(short, long)]
        output: String,
        /// Piper voice model
        #[arg(long, default_value = "en_US-lessac-medium")]
        voice: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Duration { file } => {
            let (samples, sample_rate) = analyze::decode_audio(&file)?;
            let duration = samples.len() as f64 / sample_rate as f64;
            println!("{:.6}", duration);
            Ok(())
        },
        Commands::Setup => setup::run(),
        Commands::Analyze { file } => analyze::run(&file),
        Commands::Beats { file, activation: act_fn, min_bpm, max_bpm } => {
            eprintln!("Decoding {}...", file);
            let (samples, sample_rate) = analyze::decode_audio(&file)?;
            let duration = samples.len() as f64 / sample_rate as f64;
            eprintln!("Decoded: {} samples, {}Hz, {:.1}s", samples.len(), sample_rate, duration);

            let fps = 100.0;
            eprintln!("Computing {} activation...", act_fn);
            let act = match act_fn.as_str() {
                "energy" => activation::energy_activation(&samples, sample_rate, fps),
                "spectral-flux" => activation::spectral_flux_activation(&samples, sample_rate, fps),
                other => anyhow::bail!("Unknown activation function: {other}. Use 'energy' or 'spectral-flux'."),
            };
            eprintln!("Activation: {} frames ({:.1}s at {}fps)", act.len(), act.len() as f64 / fps, fps);

            let params = dbn::BeatTrackerParams {
                min_bpm,
                max_bpm,
                fps,
                ..Default::default()
            };

            eprintln!("Running DBN beat tracker...");
            let result = dbn::track_beats(&act, &params);
            eprintln!("Found {} beats, estimated {:.1} BPM", result.beats.len(), result.bpm);

            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(())
        },
        Commands::Lookup { title, artist } => lookup::run(&title, artist.as_deref()),
        Commands::Transcribe { file, model } => transcribe::run(&file, &model),
        Commands::Unstretch { file } => unstretch::run(&file),
        Commands::Split { file, output_dir, model } => split::run(&file, &output_dir, &model),
        Commands::Speak { text, output, voice } => speak::run(&text, &output, &voice),
    }
}
