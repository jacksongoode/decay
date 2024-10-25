use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::RwLock;
use warp::{ws::WebSocket, Filter};

/// Our global unique user id counter.
static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

/// Our state of currently connected users.
type Users = Arc<RwLock<HashMap<usize, String>>>;

#[tokio::main]
async fn main() {
    // Keep track of all connected users
    let users = Users::default();
    let users = Arc::new(RwLock::new(HashMap::new()));

    // Turn our "state" into a new Filter...
    let users = warp::any().map(move || users.clone());

    // WebSocket handler
    let ws_route = warp::path("ws")
        .and(warp::ws())
        .and(users)
        .map(|ws: warp::ws::Ws, users| {
            ws.on_upgrade(move |socket| handle_connection(socket, users))
        });

    // Serve static files
    let static_files = warp::path("static").and(warp::fs::dir("www"));
    let index = warp::path::end().and(warp::fs::file("www/index.html"));

    // Combine routes
    let routes = ws_route.or(static_files).or(index);

    println!("Server started at http://localhost:3030");
    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}

async fn handle_connection(ws: WebSocket, users: Users) {
    // Assign a unique ID to this connection
    let my_id = NEXT_USER_ID.fetch_add(1, Ordering::Relaxed);

    println!("New user connected: {}", my_id);

    // Split the socket into a sender and receive of messages.
    let (user_ws_tx, mut user_ws_rx) = ws.split();

    // Save the sender in our list of connected users.
    users.write().await.insert(my_id, String::new());

    // Handle messages from user
    while let Some(result) = user_ws_rx.next().await {
        match result {
            Ok(msg) => {
                println!("Got message from {}: {:?}", my_id, msg);
                // Handle the message...
            }
            Err(e) => {
                eprintln!("websocket error(uid={}): {}", my_id, e);
                break;
            }
        }
    }

    // User disconnected
    users.write().await.remove(&my_id);
}
