use clap::{Parser, Subcommand};
use anyhow::Result;

mod analyze;
mod transcribe;
mod speak;

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
        Commands::Transcribe { file, model } => transcribe::run(&file, &model),
        Commands::Speak { text, output, voice } => speak::run(&text, &output, &voice),
    }
}
