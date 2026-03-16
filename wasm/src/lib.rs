pub mod api;

use std::sync::OnceLock;

use reqwest::{Client, StatusCode};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::api::{PostData, RedditResponse};

static REDDIT_CLIENT: OnceLock<Client> = OnceLock::new();
const RATE_LIMITED_ERROR: &str = "BLIND_VOTE_RATE_LIMITED";

fn get_client() -> &'static Client {
    REDDIT_CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent("rust:blind_vote:v0.1.0 (by /u/Typical-Tomatillo138)")
            .build()
            .expect("Failed to initialize Reddit Client")
    })
}

impl PostData {
    pub async fn from_post_id(post_id: &str) -> Result<Self, String> {
        // post_id: e.g. t3_1ht65gt
        let url = format!("https://api.reddit.com/api/info/?id={}", post_id);

        let response = get_client()
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Request failed: {error}"))?;
        let status = response.status();

        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(RATE_LIMITED_ERROR.to_string());
        }

        if !status.is_success() {
            return Err(format!("Request failed with status: {status}"));
        }

        let reddit_data = response
            .json::<RedditResponse>()
            .await
            .map_err(|error| format!("Failed to parse Reddit response: {error}"))?;

        let post = reddit_data
            .data
            .children
            .first()
            .ok_or_else(|| "Failed to parse Reddit response: missing post data".to_string())?
            .data
            .clone();
        Ok(post)
    }
}
#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub enum Vote {
    Up,
    Down,
    NA,
}

#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct Archive {
    votes: FxHashMap<String, (Vote, PostData)>, // Post ID, (Vote, Post data)
    baseline_posts: Vec<(String, PostData)>, // Sorted according to timestamp, see `insert_baseline()` below
    dirty: bool,                             // Needs saving to DB?
}

#[wasm_bindgen]
impl Archive {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            votes: FxHashMap::default(),
            baseline_posts: Vec::new(),
            dirty: false,
        }
    }
    pub fn to_vec(&self) -> Vec<u8> {
        postcard::to_allocvec(self).expect("Archive serialization failed")
    }

    pub fn from_bytes(bytes: &[u8]) -> Self {
        postcard::from_bytes(bytes).expect("Archive deserialization failed")
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }

    pub async fn insert_vote(&mut self, post_id: String, vote: Vote) -> Result<(), JsValue> {
        let exists = self.votes.keys().any(|v| v == &post_id);

        if !exists {
            let post_data = PostData::from_post_id(&post_id)
                .await
                .map_err(|error| JsValue::from_str(&error))?;
            self.votes.insert(post_id, (vote, post_data));
            self.dirty = true;
        }
        Ok(())
    }

    pub async fn insert_baseline(&mut self, post_id: String) -> Result<(), JsValue> {
        let exists = self.baseline_posts.iter().any(|(id, _)| id == &post_id);

        if !exists {
            let post_data = PostData::from_post_id(&post_id)
                .await
                .map_err(|error| JsValue::from_str(&error))?;
            let idx = self
                .baseline_posts
                .partition_point(|(_, p)| p.created <= post_data.created);
            self.baseline_posts.insert(idx, (post_id, post_data));
            self.dirty = true;
        }
        Ok(())
    }
}

#[wasm_bindgen(start)]
pub fn main() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    Ok(())
}
