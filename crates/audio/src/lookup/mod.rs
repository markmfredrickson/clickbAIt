pub mod deezer;
pub mod genius;
pub mod musicbrainz;

use anyhow::Result;

#[tokio::main]
pub async fn run(title: &str, artist: Option<&str>) -> Result<()> {
    let _ = dotenvy::dotenv(); // load .env if present, ignore if missing
    eprintln!("Looking up: \"{}\"{}...", title, artist.map_or(String::new(), |a| format!(" by {}", a)));

    // Run all sources in parallel
    let (dz, mb, ge) = tokio::join!(
        deezer::search_track(title, artist),
        musicbrainz::search_recording(title, artist),
        genius::search_lyrics(title, artist),
    );

    // Format results
    let mut lines = Vec::new();

    match mb {
        Ok(Some(r)) => {
            lines.push(format!("MusicBrainz: {} by {}", r.title, r.artist.as_deref().unwrap_or("?")));
            if let Some(album) = &r.album {
                lines.push(format!("  Album: {}", album));
            }
            if let Some(dur) = &r.duration {
                lines.push(format!("  Duration: {}", dur));
            }
        }
        Ok(None) => lines.push("MusicBrainz: not found".to_string()),
        Err(e) => lines.push(format!("MusicBrainz: error — {}", e)),
    }

    match dz {
        Ok(Some(r)) => {
            lines.push(format!("Deezer: {} by {}", r.title, r.artist));
            if let Some(bpm) = r.bpm {
                lines.push(format!("  BPM: {}", bpm));
            }
            let mins = r.duration_sec / 60;
            let secs = r.duration_sec % 60;
            lines.push(format!("  Duration: {}:{:02}", mins, secs));
        }
        Ok(None) => lines.push("Deezer: not found".to_string()),
        Err(e) => lines.push(format!("Deezer: error — {}", e)),
    }

    match ge {
        Ok(Some(r)) => {
            lines.push(format!("Genius: {} by {}", r.title, r.artist));
            lines.push(format!("  Sections found: {}", r.sections.len()));
            for section in &r.sections {
                lines.push(format!("\n  [{}]", section.name));
                lines.push(format!("  {}", section.lyrics));
            }
        }
        Ok(None) => lines.push("Genius: not found (GENIUS_API_TOKEN may not be set)".to_string()),
        Err(e) => lines.push(format!("Genius: error — {}", e)),
    }

    if lines.iter().all(|l| l.contains("not found") || l.contains("error")) {
        println!("No results found from any source.");
    } else {
        println!("{}", lines.join("\n"));
    }

    Ok(())
}
