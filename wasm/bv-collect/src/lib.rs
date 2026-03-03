use bv_shared::{Archive, PostInfo, Vote};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "Archive")]
pub struct ArchiveHandle {
    inner: Archive,
}

#[wasm_bindgen]
impl ArchiveHandle {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Archive::new(),
        }
    }

    pub fn from_uint8array(bytes: &[u8]) -> Self {
        Self {
            inner: Archive::from_bytes(bytes),
        }
    }

    pub fn to_uint8array(&self) -> Vec<u8> {
        self.inner.to_vec()
    }

    pub fn insert_vote(
        &mut self,
        post_id: String,
        direction: u8,
        timestamp: u64,
        post_score: u32,
        upvote_ratio: f32,
    ) {
        let info = PostInfo {
            timestamp,
            post_score,
            upvote_ratio,
        };
        let vote = match direction {
            0 => Vote::Up(info),
            1 => Vote::Down(info),
            _ => Vote::NA,
        };
        self.inner.insert_vote(post_id, vote);
    }

    pub fn insert_baseline(&mut self, timestamp: u64, post_score: u32, upvote_ratio: f32) {
        self.inner.insert_baseline(PostInfo {
            timestamp,
            post_score,
            upvote_ratio,
        });
    }
}
