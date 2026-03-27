use anyhow::Result;

pub fn run(text: &str, output: &str, voice: &str) -> Result<()> {
    eprintln!("Speaking \"{}\" with voice {} → {}", text, voice, output);

    // TODO: implement with piper-rs
    // 1. Load piper voice model
    // 2. Synthesize text to audio
    // 3. Write to output file (wav)

    anyhow::bail!("Not yet implemented. See crates/audio/src/speak.rs")
}
