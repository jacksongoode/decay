use axum::response::IntoResponse;
use axum::{
    extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
    extract::State,
    http::{HeaderName, HeaderValue, Method},
    response::Response,
    routing::get,
    Json, Router,
};
use axum_server::Handle;
use decay_server::config::Config;
use decay_server::types::{Message, User};
use dotenv::dotenv;
use env_logger::init;
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde_json::json;
use std::collections::HashSet;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{mpsc, RwLock};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

/// Our global unique user id counter.
static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

/// Our state of currently connected users.
type Users = Arc<RwLock<HashMap<usize, ConnectionState>>>;

#[tokio::main]
async fn main() {
    // Load .env file
    dotenv().ok();

    // Load configuration
    let config = Config::default();

    // Setup logging
    init();

    // Keep track of all connected users
    let users = Users::default();

    // Create our application with routes
    let app = create_routes(users);

    // Parse addresses
    let http_addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid HTTP address");

    // Create shutdown handle
    let handle = Handle::new();

    let display_addr = if http_addr.ip().is_unspecified() {
        SocketAddr::new("127.0.0.1".parse().unwrap(), http_addr.port())
    } else {
        http_addr
    };
    println!("Starting HTTP server on http://{}", display_addr);

    // Start HTTP server
    let http_server = axum_server::bind(http_addr)
        .handle(handle.clone())
        .serve(app.clone().into_make_service());

    // If TLS is enabled, also start HTTPS server
    if config.tls_enabled {
        let https_addr: SocketAddr = format!("{}:{}", config.host, config.tls_port)
            .parse()
            .expect("Invalid HTTPS address");

        let cert_path = config
            .cert_path
            .expect("TLS enabled but no cert path provided");
        let key_path = config
            .key_path
            .expect("TLS enabled but no key path provided");

        let display_https_addr = if https_addr.ip().is_unspecified() {
            SocketAddr::new("127.0.0.1".parse().unwrap(), https_addr.port())
        } else {
            https_addr
        };
        println!("Starting HTTPS server on https://{}", display_https_addr);

        let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert_path, key_path)
            .await
            .expect("Failed to load TLS config");

        let https_server = axum_server::bind_rustls(https_addr, config)
            .handle(handle)
            .serve(app.into_make_service());

        // Run both servers
        tokio::select! {
            result = http_server => {
                if let Err(e) = result {
                    eprintln!("HTTP server error: {}", e);
                }
            }
            result = https_server => {
                if let Err(e) = result {
                    eprintln!("HTTPS server error: {}", e);
                }
            }
        }
    } else {
        // Just run HTTP server
        if let Err(e) = http_server.await {
            eprintln!("HTTP server error: {}", e);
        }
    }
}

fn create_routes(users: Users) -> Router {
    // Create CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("x-requested-with"),
        ]);

    Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/turn-credentials", get(turn_credentials_handler))
        .nest_service(
            "/static",
            ServeDir::new("www/static").append_index_html_on_directories(false),
        )
        .fallback_service(ServeDir::new("www").append_index_html_on_directories(true))
        .layer(cors)
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("cross-origin-opener-policy"),
            HeaderValue::from_static("same-origin"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("cross-origin-embedder-policy"),
            HeaderValue::from_static("require-corp"),
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(users)
}

async fn ws_handler(ws: WebSocketUpgrade, State(users): State<Users>) -> Response {
    ws.on_upgrade(|socket| handle_connection(socket, users))
}

async fn handle_connection(ws: WebSocket, users: Users) {
    let my_id = NEXT_USER_ID.fetch_add(1, Ordering::Relaxed);
    let (mut sender, mut receiver) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel();

    // Initialize connection state
    let connection_state = ConnectionState {
        last_activity: std::time::Instant::now(),
        tx: tx.clone(),
        connections: HashSet::new(),
    };

    // Store the connection state
    users.write().await.insert(my_id, connection_state);

    // Spawn timeout monitoring task
    let timeout_task = tokio::spawn({
        let users = users.clone();
        async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            let timeout_duration = Duration::from_secs(60);

            loop {
                interval.tick().await;
                if let Some(state) = users.read().await.get(&my_id) {
                    if state.last_activity.elapsed() > timeout_duration {
                        let _ = state.tx.send(Ok(WsMessage::Close(None)));
                        users.write().await.remove(&my_id);
                        break;
                    }
                } else {
                    break;
                }
            }
        }
    });

    // Spawn heartbeat task
    let heartbeat_task = tokio::spawn({
        let tx = tx.clone();
        async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if tx.send(Ok(WsMessage::Ping(vec![]))).is_err() {
                    break;
                }
            }
        }
    });

    // Send initial welcome message
    let welcome = serde_json::to_string(&Message::Welcome { user_id: my_id }).unwrap();
    if sender.send(WsMessage::Text(welcome)).await.is_err() {
        return;
    }

    // Broadcast updated user list
    broadcast_user_list(&users).await;

    // Spawn message forwarding task
    let forward_task = tokio::spawn({
        let mut sender = sender;
        async move {
            while let Some(message) = rx.recv().await {
                if sender.send(message?).await.is_err() {
                    break;
                }
            }
            Ok::<_, axum::Error>(())
        }
    });

    // Clone users for message handling
    let users_clone = users.clone();

    // Main message handling loop
    while let Some(Ok(msg)) = receiver.next().await {
        // Update last activity timestamp
        if let Some(state) = users.write().await.get_mut(&my_id) {
            state.last_activity = std::time::Instant::now();
        }

        match msg {
            WsMessage::Text(text) => {
                if let Ok(message) = serde_json::from_str::<Message>(&text) {
                    match &message {
                        Message::PeerStateChange {
                            from_id,
                            to_id,
                            state,
                        } => {
                            // Handle peer state changes
                            if let Some(target_state) = users.read().await.get(to_id) {
                                let _ = target_state.tx.send(Ok(WsMessage::Text(text.clone())));
                            }

                            // Update connection state based on the state string
                            match state.as_str() {
                                "disconnected" => {
                                    if let Some(from_state) = users.write().await.get_mut(from_id) {
                                        from_state.connections.remove(to_id);
                                    }
                                    if let Some(to_state) = users.write().await.get_mut(to_id) {
                                        to_state.connections.remove(from_id);
                                    }
                                }
                                "connected" => {
                                    if let Some(from_state) = users.write().await.get_mut(from_id) {
                                        from_state.connections.insert(*to_id);
                                    }
                                    if let Some(to_state) = users.write().await.get_mut(to_id) {
                                        to_state.connections.insert(*from_id);
                                    }
                                }
                                _ => {} // Handle other states if needed
                            }
                        }
                        // Handle targeted messages
                        _ => {
                            let target_id = match &message {
                                Message::ConnectionRequest { to_id, .. } => Some(*to_id),
                                Message::RTCOffer { to_id, .. } => Some(*to_id),
                                Message::RTCAnswer { to_id, .. } => Some(*to_id),
                                Message::RTCCandidate { to_id, .. } => Some(*to_id),
                                Message::ConnectionResponse { from_id, .. } => Some(*from_id),
                                _ => None,
                            };

                            if let Some(target_id) = target_id {
                                if let Some(target_state) = users_clone.read().await.get(&target_id)
                                {
                                    let msg = serde_json::to_string(&message).unwrap();
                                    let _ = target_state.tx.send(Ok(WsMessage::Text(msg)));
                                }
                            }
                        }
                    }
                }
            }
            WsMessage::Pong(_) => {
                // Update activity timestamp on pong response
                if let Some(state) = users.write().await.get_mut(&my_id) {
                    state.last_activity = std::time::Instant::now();
                }
            }
            WsMessage::Close(_) => {
                // Notify all connected peers about disconnection
                let users_lock = users.read().await;
                if let Some(state) = users_lock.get(&my_id) {
                    for &peer_id in &state.connections {
                        if let Some(peer_state) = users_lock.get(&peer_id) {
                            let disconnect_msg = Message::PeerStateChange {
                                from_id: my_id,
                                to_id: peer_id,
                                state: "disconnected".to_string(),
                            };
                            let _ = peer_state.tx.send(Ok(WsMessage::Text(
                                serde_json::to_string(&disconnect_msg).unwrap(),
                            )));
                        }
                    }
                }
                break;
            }
            _ => {} // Handle other message types if needed
        }
    }

    // Cleanup on disconnect
    users.write().await.remove(&my_id);
    broadcast_user_list(&users).await;

    // Abort background tasks
    heartbeat_task.abort();
    timeout_task.abort();
    forward_task.abort();
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
    for state in users_lock.values() {
        let _ = state.tx.send(Ok(WsMessage::Text(message.clone())));
    }
}

async fn turn_credentials_handler() -> impl IntoResponse {
    let credentials = json!({
        "iceServers": [{
            "urls": "stun:stun.l.google.com:19302"
        }, {
            "urls": [
                "turn:global.relay.metered.ca:80",
                "turn:global.relay.metered.ca:443"
            ],
            "username": std::env::var("TURN_USERNAME").unwrap_or_default(),
            "credential": std::env::var("TURN_CREDENTIAL").unwrap_or_default()
        }]
    });

    Json(credentials)
}

struct ConnectionState {
    last_activity: std::time::Instant,
    tx: mpsc::UnboundedSender<Result<WsMessage, axum::Error>>,
    connections: HashSet<usize>,
}

impl Default for ConnectionState {
    fn default() -> Self {
        Self {
            last_activity: std::time::Instant::now(),
            tx: mpsc::unbounded_channel().0,
            connections: HashSet::new(),
        }
    }
}
