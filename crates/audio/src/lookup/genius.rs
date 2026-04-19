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
pub struct GeniusResult {
    pub title: String,
    pub artist: String,
    /// Raw concatenated text from the Genius page's lyric containers, with
    /// `<br>` tags converted to newlines. Includes whatever metadata/annotation
    /// preamble Genius chose to render that day. Downstream consumers (Haiku,
    /// the user's eye) do section extraction and cleanup — this stays dumb on
    /// purpose so Genius formatting changes don't break the Rust layer.
    pub raw_text: String,
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

    let raw_text = extract_lyrics_text(&page_html);

    Ok(Some(GeniusResult {
        title: song_title,
        artist: song_artist,
        raw_text,
    }))
}

fn extract_lyrics_text(html: &str) -> String {
    use scraper::{Html, Selector};

    let doc = Html::parse_document(html);
    let container_sel = Selector::parse("[data-lyrics-container]").unwrap();

    let mut text = String::new();
    for container in doc.select(&container_sel) {
        for node in container.descendants() {
            match node.value() {
                scraper::node::Node::Text(t) => text.push_str(t),
                scraper::node::Node::Element(el) if el.name() == "br" => text.push('\n'),
                _ => {}
            }
        }
        text.push('\n');
    }

    // Sampled 20 Genius pages; three obvious patterns worth stripping up-front:
    //
    //   1. Page chrome "NN ContributorsTranslations…Lyrics" before the lyric
    //      containers. Sentinel: the literal word "Lyrics".
    //   2. An editorial annotation blurb that always ends with "Read More"
    //      (~90% of pages have one; the rest go straight to a section marker).
    //   3. Stray `<img src="...genius.com/avatars/...">` tags in ~25% of pages.
    //
    // Strip those three. Anything else (annotation variants, mid-text junk,
    // section naming quirks) is left to Haiku downstream — not worth chasing.
    if let Some(idx) = text.find("Lyrics") {
        text = text[idx + "Lyrics".len()..].to_string();
    }
    if let Some(idx) = text.find("Read More") {
        text = text[idx + "Read More".len()..].to_string();
    }
    strip_html_tags(&text).trim().to_string()
}

/// Remove any `<tag ...>` fragments. Not a real HTML parser — just a best-effort
/// drop for stray tags (chiefly `<img>`) that leak from the Genius page.
fn strip_html_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

