use futures_util::stream::StreamExt;
use futures_util::SinkExt;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use warp::ws::{Message as WsMessage, WebSocket};
use warp::Filter;

use decay::types::{Message, User};

/// Our global unique user id counter.
static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

/// Our state of currently connected users.
type Users = Arc<RwLock<HashMap<usize, mpsc::UnboundedSender<Result<WsMessage, warp::Error>>>>>;

#[tokio::main]
async fn main() {
    // Keep track of all connected users
    let users = Users::default();

    // Turn our "state" into a new Filter...
    let users = warp::any().map(move || users.clone());

    // WebSocket handler
    let routes = warp::path("ws")
        .and(warp::ws())
        .and(users)
        .map(|ws: warp::ws::Ws, users| {
            ws.on_upgrade(move |socket| handle_connection(socket, users))
        })
        .or(warp::path("static").and(warp::fs::dir("www")))
        .or(warp::path::end().and(warp::fs::file("www/index.html")));

    println!("Server started at http://localhost:3030");
    warp::serve(routes).run(([0, 0, 0, 0], 3030)).await;
}

async fn handle_connection(ws: WebSocket, users: Users) {
    let my_id = NEXT_USER_ID.fetch_add(1, Ordering::Relaxed);
    println!("New user connected: {}", my_id);

    let (mut user_ws_tx, mut user_ws_rx) = ws.split();

    // Send welcome and setup user
    let welcome = serde_json::to_string(&Message::Welcome { user_id: my_id }).unwrap();
    let _ = user_ws_tx.send(WsMessage::text(welcome)).await;

    let (tx, mut rx) = mpsc::unbounded_channel();
    users.write().await.insert(my_id, tx);
    broadcast_user_list(&users).await;

    // Forward messages to WebSocket
    let users_clone = users.clone();
    let mut forward_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if user_ws_tx.send(message?).await.is_err() {
                break;
            }
        }
        Ok::<_, warp::Error>(())
    });

    // Handle incoming WebSocket messages
    while let Some(Ok(msg)) = user_ws_rx.next().await {
        if let Ok(text) = msg.to_str() {
            if let Ok(message) = serde_json::from_str::<Message>(text) {
                match message {
                    Message::ConnectionRequest { from_id, to_id } => {
                        if let Some(target_tx) = users_clone.read().await.get(&to_id) {
                            let msg = serde_json::to_string(&Message::ConnectionRequest {
                                from_id,
                                to_id,
                            })
                            .unwrap();
                            let _ = target_tx.send(Ok(WsMessage::text(msg)));
                        }
                    }
                    Message::ConnectionResponse { from_id, accepted } => {
                        if let Some(target_tx) = users_clone.read().await.get(&from_id) {
                            let msg = serde_json::to_string(&Message::ConnectionResponse {
                                from_id: my_id,
                                accepted,
                            })
                            .unwrap();
                            let _ = target_tx.send(Ok(WsMessage::text(msg)));
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Cleanup on disconnect
    users_clone.write().await.remove(&my_id);
    broadcast_user_list(&users_clone).await;
    let _ = forward_task.abort();
}

async fn broadcast_user_list(users: &Users) {
    let users_lock = users.read().await;
    let user_list = users_lock
        .iter()
        .map(|(&id, _)| User {
            id,
            name: format!("User {}", id),
        })
        .collect();

    let message = serde_json::to_string(&Message::UserList { users: user_list }).unwrap();
    for tx in users_lock.values() {
        let _ = tx.send(Ok(WsMessage::text(message.clone())));
    }
}
