use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct RedditResponse {
    pub kind: String,
    pub data: ListingData,
}

#[derive(Debug, Deserialize)]
pub struct ListingData {
    pub children: Vec<RedditChild>,
}

#[derive(Debug, Deserialize)]
pub struct RedditChild {
    pub kind: String,
    pub data: PostData,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PostData {
    pub name: String,      // id, e.g. t3_1rnj45o
    pub created: f64,      // UNIX Timestamp of post creation
    pub score: u64,        // Post karma
    pub upvote_ratio: f64, // Percentage of upvotes
}
