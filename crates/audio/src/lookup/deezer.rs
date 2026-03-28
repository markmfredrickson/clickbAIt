use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct SearchResponse {
    data: Vec<SearchTrack>,
}

#[derive(Debug, Deserialize)]
struct SearchTrack {
    id: u64,
    title: String,
    duration: u32,
    artist: Artist,
}

#[derive(Debug, Deserialize)]
struct Artist {
    name: String,
}

/// Full track detail (from /track/{id}) — has BPM
#[derive(Debug, Deserialize)]
struct TrackDetail {
    title: String,
    duration: u32,
    bpm: f64,
    artist: Artist,
    album: Option<Album>,
}

#[derive(Debug, Deserialize)]
struct Album {
    title: String,
}

#[derive(Debug)]
pub struct DeezerResult {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_sec: u32,
    pub bpm: Option<f64>,
}

pub async fn search_track(title: &str, artist: Option<&str>) -> Result<Option<DeezerResult>> {
    let query = match artist {
        Some(a) => format!("track:\"{}\" artist:\"{}\"", title, a),
        None => format!("track:\"{}\"", title),
    };

    let url = format!("https://api.deezer.com/search?q={}", urlencod(&query));
    let resp: SearchResponse = reqwest::get(&url).await?.json().await?;

    let search_track = match resp.data.first() {
        Some(t) => t,
        None => return Ok(None),
    };

    // Fetch full track details for BPM
    let detail_url = format!("https://api.deezer.com/track/{}", search_track.id);
    let detail: TrackDetail = reqwest::get(&detail_url).await?.json().await?;

    let bpm = if detail.bpm > 0.0 { Some(detail.bpm) } else { None };

    Ok(Some(DeezerResult {
        title: detail.title,
        artist: detail.artist.name,
        album: detail.album.map(|a| a.title),
        duration_sec: detail.duration,
        bpm,
    }))
}

pub(super) fn urlencod(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                String::from(b as char)
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}
