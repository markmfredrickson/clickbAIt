use clap::{Parser, Subcommand};
use anyhow::Result;

mod analyze;
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
    /// Extract BPM, key, and beat positions from an audio file
    Analyze {
        /// Path to audio file
        file: String,
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
        Commands::Lookup { title, artist } => lookup::run(&title, artist.as_deref()),
        Commands::Transcribe { file, model } => transcribe::run(&file, &model),
        Commands::Unstretch { file } => unstretch::run(&file),
        Commands::Split { file, output_dir, model } => split::run(&file, &output_dir, &model),
        Commands::Speak { text, output, voice } => speak::run(&text, &output, &voice),
    }
}
