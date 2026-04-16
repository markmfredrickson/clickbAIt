use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct SearchResponse {
    response: SearchHits,
}

#[derive(Debug, Deserialize)]
struct SearchHits {
    hits: Vec<Hit>,
}

#[derive(Debug, Deserialize)]
struct Hit {
    result: HitResult,
}

#[derive(Debug, Deserialize)]
struct HitResult {
    title: String,
    url: String,
    primary_artist: PrimaryArtist,
}

#[derive(Debug, Deserialize)]
struct PrimaryArtist {
    name: String,
}

#[derive(Debug)]
pub struct LyricsSection {
    pub name: String,
    pub lyrics: String,
}

#[derive(Debug)]
pub struct GeniusResult {
    pub title: String,
    pub artist: String,
    pub sections: Vec<LyricsSection>,
}

pub async fn search_lyrics(title: &str, artist: Option<&str>) -> Result<Option<GeniusResult>> {
    let token = match std::env::var("GENIUS_API_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => return Ok(None), // silently skip if no token
    };

    let query = match artist {
        Some(a) => format!("{} {}", title, a),
        None => title.to_string(),
    };

    let client = reqwest::Client::new();

    // Search for the song
    let search_url = format!(
        "https://api.genius.com/search?q={}",
        super::deezer::urlencod(&query),
    );
    let search_resp: SearchResponse = client
        .get(&search_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await?
        .json()
        .await?;

    let hit = match search_resp.response.hits.first() {
        Some(h) => h,
        None => return Ok(None),
    };

    let song_title = hit.result.title.clone();
    let song_artist = hit.result.primary_artist.name.clone();
    let song_url = hit.result.url.clone();

    // Scrape lyrics from the song page
    let page_html = client
        .get(&song_url)
        .send()
        .await?
        .text()
        .await
        .context("Failed to fetch Genius lyrics page")?;

    let sections = parse_lyrics_html(&page_html);

    Ok(Some(GeniusResult {
        title: song_title,
        artist: song_artist,
        sections,
    }))
}

fn parse_lyrics_html(html: &str) -> Vec<LyricsSection> {
    use scraper::{Html, Selector};

    let doc = Html::parse_document(html);
    let container_sel = Selector::parse("[data-lyrics-container]").unwrap();

    // Collect all text from lyrics containers
    let mut raw_text = String::new();
    for container in doc.select(&container_sel) {
        // Walk the DOM and convert <br> to newlines
        for node in container.descendants() {
            match node.value() {
                scraper::node::Node::Text(t) => raw_text.push_str(t),
                scraper::node::Node::Element(el) if el.name() == "br" => raw_text.push('\n'),
                _ => {}
            }
        }
        raw_text.push('\n');
    }

    // Parse sections from [Marker] annotations
    let mut sections = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();

    for line in raw_text.lines() {
        let trimmed = line.trim();
        // Section markers may be glued to preceding metadata text
        // (e.g. "78 ContributorsTranslations...Lyrics[Verse 1]")
        // so search for [Name] anywhere in the line, not just at boundaries.
        if let (Some(open), Some(close)) = (trimmed.rfind('['), trimmed.rfind(']')) {
            if open < close {
                let candidate = &trimmed[open + 1..close];
                // Only treat as a section if it looks like a song section
                let lower = candidate.to_lowercase();
                let is_section = ["verse", "chorus", "bridge", "intro", "outro",
                    "hook", "pre-chorus", "pre chorus", "post-chorus", "post chorus",
                    "refrain", "interlude", "solo", "instrumental", "break", "coda",
                    "skit", "spoken", "outro"]
                    .iter()
                    .any(|kw| lower.contains(kw));
                if is_section {
                    // Save previous section
                    if let Some(name) = current_name.take() {
                        let lyrics = current_lines.join("\n").trim().to_string();
                        if !lyrics.is_empty() {
                            sections.push(LyricsSection { name, lyrics });
                        }
                    }
                    current_name = Some(candidate.to_string());
                    current_lines.clear();
                    continue;
                }
            }
        }
        if current_name.is_some() && !trimmed.is_empty() {
            current_lines.push(trimmed.to_string());
        }
    }

    // Final section
    if let Some(name) = current_name {
        let lyrics = current_lines.join("\n").trim().to_string();
        if !lyrics.is_empty() {
            sections.push(LyricsSection { name, lyrics });
        }
    }

    sections
}
