use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Message {
    Welcome { user_id: usize },
    UserList { users: Vec<User> },
    ConnectionRequest { from_id: usize, to_id: usize },
    ConnectionResponse { from_id: usize, accepted: bool },
    RTCOffer { from_id: usize, to_id: usize, offer: String },
    RTCAnswer { from_id: usize, to_id: usize, answer: String },
    RTCCandidate { from_id: usize, to_id: usize, candidate: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: usize,
    pub name: String,
}
