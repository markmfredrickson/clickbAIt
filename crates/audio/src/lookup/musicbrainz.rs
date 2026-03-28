use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct SearchResponse {
    recordings: Vec<Recording>,
}

#[derive(Debug, Deserialize)]
struct Recording {
    id: String,
    title: String,
    #[serde(default)]
    length: Option<u64>,
    #[serde(default)]
    score: u32,
    #[serde(default, rename = "artist-credit")]
    artist_credit: Vec<ArtistCredit>,
    #[serde(default, rename = "release-list")]
    releases: Vec<Release>,
    #[serde(default)]
    disambiguation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ArtistCredit {
    name: String,
}

#[derive(Debug, Deserialize)]
struct Release {
    title: String,
}

#[derive(Debug)]
pub struct MusicBrainzResult {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub mbid: String,
    pub duration_ms: Option<u64>,
    pub duration: Option<String>,
}

pub async fn search_recording(title: &str, artist: Option<&str>) -> Result<Option<MusicBrainzResult>> {
    let query = match artist {
        Some(a) => format!("\"{}\" AND artist:\"{}\"", title, a),
        None => title.to_string(),
    };

    let url = format!(
        "https://musicbrainz.org/ws/2/recording/?query={}&limit=10&fmt=json",
        super::deezer::urlencod(&query),
    );

    let client = reqwest::Client::new();
    let resp: SearchResponse = client
        .get(&url)
        .header("User-Agent", "clickbAIt/0.1.0 (https://github.com/clickbait)")
        .send()
        .await?
        .json()
        .await?;

    let recordings = &resp.recordings;
    if recordings.is_empty() {
        return Ok(None);
    }

    // Prefer non-live recordings
    let rec = recordings
        .iter()
        .find(|r| {
            r.disambiguation
                .as_deref()
                .map_or(true, |d| !d.to_lowercase().contains("live"))
        })
        .unwrap_or(&recordings[0]);

    let artist_name = rec.artist_credit.first().map(|a| a.name.clone());
    let album = rec.releases.first().map(|r| r.title.clone());

    let duration_str = rec.length.map(|ms| {
        let total_secs = ms / 1000;
        format!("{}:{:02}", total_secs / 60, total_secs % 60)
    });

    Ok(Some(MusicBrainzResult {
        title: rec.title.clone(),
        artist: artist_name,
        album,
        mbid: rec.id.clone(),
        duration_ms: rec.length,
        duration: duration_str,
    }))
}
