use anyhow::Result;
use scraper::{Html, Selector};

const THEORYTAB_BASE: &str = "https://www.hooktheory.com/theorytab/view";

fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    slug.trim_end_matches('-').to_string()
}

#[derive(Debug)]
pub struct HooktheoryResult {
    pub title: String,
    pub artist: String,
    pub keys: Vec<String>,
    pub sections: Vec<String>,
    pub url: String,
}

pub async fn lookup_song(title: &str, artist: &str) -> Result<Option<HooktheoryResult>> {
    let artist_slug = slugify(artist);
    let song_slug = slugify(title);
    let url = format!("{}/{}/{}", THEORYTAB_BASE, artist_slug, song_slug);

    let resp = reqwest::get(&url).await?;
    if !resp.status().is_success() {
        return Ok(None);
    }

    let html = resp.text().await?;
    let doc = Html::parse_document(&html);

    // Extract keys
    let mut keys = Vec::new();
    let p_selector = Selector::parse("p").unwrap();
    for p in doc.select(&p_selector) {
        let text = p.text().collect::<String>();
        if text.contains("analyzed in the following keys") {
            let a_selector = Selector::parse("a").unwrap();
            for a in p.select(&a_selector) {
                if let Some(href) = a.value().attr("href") {
                    if href.contains("cheat-sheet/key") {
                        let key_text: String = a.text().collect();
                        let trimmed = key_text.trim().to_string();
                        if !trimmed.is_empty() {
                            keys.push(trimmed);
                        }
                    }
                }
            }
        }
    }

    // Extract sections from anchor links
    let section_pattern = format!("{}#", song_slug);
    let a_selector = Selector::parse("a").unwrap();
    let span_selector = Selector::parse("span").unwrap();
    let mut sections = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for a in doc.select(&a_selector) {
        if let Some(href) = a.value().attr("href") {
            if href.contains(&section_pattern) {
                for span in a.select(&span_selector) {
                    let name: String = span.text().collect();
                    let name = name.trim().to_string();
                    if !name.is_empty() && seen.insert(name.clone()) {
                        sections.push(name);
                    }
                }
            }
        }
    }

    if keys.is_empty() && sections.is_empty() {
        return Ok(None);
    }

    Ok(Some(HooktheoryResult {
        title: title.to_string(),
        artist: artist.to_string(),
        keys,
        sections,
        url,
    }))
}
