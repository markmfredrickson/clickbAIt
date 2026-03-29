use clap::{Parser, Subcommand};
use anyhow::Result;

mod analyze;
mod lookup;
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
        Commands::Analyze { file } => analyze::run(&file),
        Commands::Lookup { title, artist } => lookup::run(&title, artist.as_deref()),
        Commands::Transcribe { file, model } => transcribe::run(&file, &model),
        Commands::Unstretch { file } => unstretch::run(&file),
        Commands::Speak { text, output, voice } => speak::run(&text, &output, &voice),
    }
}
