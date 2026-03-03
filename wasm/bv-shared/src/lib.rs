use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct PostInfo {
    pub timestamp: u64,    // UNIX Timestamp of post creation
    pub post_score: u32,   // Post karma
    pub upvote_ratio: f32, // Percentage of upvotes
}

#[derive(Serialize, Deserialize)]
pub enum Vote {
    Up(PostInfo),
    Down(PostInfo),
    NA,
}

#[derive(Serialize, Deserialize)]
pub struct Archive {
    votes: FxHashMap<String, Vote>, // Post ID, Vote
    baseline_posts: Vec<PostInfo>,  // Sorted according to timestamp, see `insert_baseline()` below
}

impl Archive {
    pub fn new() -> Self {
        Self {
            votes: FxHashMap::default(),
            baseline_posts: Vec::new(),
        }
    }
    pub fn to_vec(&self) -> Vec<u8> {
        postcard::to_allocvec(self).expect("Archive serialization failed")
    }

    pub fn from_bytes(bytes: &[u8]) -> Self {
        postcard::from_bytes(bytes).expect("Archive deserialization failed")
    }

    pub fn insert_vote(&mut self, post_id: String, vote: Vote) {
        self.votes.entry(post_id).or_insert(vote); // Insert vote only if the post does not exist in the archive
    }

    pub fn insert_baseline(&mut self, post_info: PostInfo) {
        let idx = self
            .baseline_posts
            .partition_point(|p| p.timestamp <= post_info.timestamp);
        self.baseline_posts.insert(idx, post_info);
    }
}
