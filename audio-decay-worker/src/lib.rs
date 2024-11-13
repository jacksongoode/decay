use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use worker::*;

static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
struct User {
    id: usize,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum Message {
    Welcome {
        user_id: usize,
    },
    UserList {
        users: Vec<User>,
    },
    PeerStateChange {
        from_id: usize,
        to_id: usize,
        state: String,
    },
    ConnectionRequest {
        to_id: usize,
    },
    ConnectionResponse {
        from_id: usize,
    },
    RTCOffer {
        to_id: usize,
        offer: String,
    },
    RTCAnswer {
        to_id: usize,
        answer: String,
    },
    RTCCandidate {
        to_id: usize,
        candidate: String,
    },
}

#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let cors_headers = Cors::new()
        .with_origins(vec!["*"])
        .with_methods(vec![Method::Get, Method::Post, Method::Options])
        .with_allowed_headers(vec!["content-type"]);

    Router::new()
        .get("/", |_, _| {
            let mut resp = Response::ok("Audio Decay Worker")?;
            resp.headers_mut()
                .append("Access-Control-Allow-Origin", "*");
            Ok(resp)
        })
        .get_async("/api/turn-credentials", |_, ctx| async move {
            let credentials = json!({
                "iceServers": [{
                    "urls": "stun:stun.l.google.com:19302"
                }, {
                    "urls": [
                        "turn:global.relay.metered.ca:80",
                        "turn:global.relay.metered.ca:443"
                    ],
                    "username": ctx.env.secret("TURN_USERNAME")?.to_string(),
                    "credential": ctx.env.secret("TURN_CREDENTIAL")?.to_string()
                }]
            });

            let mut resp = Response::from_json(&credentials)?;
            resp.headers_mut()
                .append("Access-Control-Allow-Origin", "*");
            Ok(resp)
        })
        .get_async("/ws", handle_ws)
        .options("*", |_, _| {
            let mut resp = Response::empty()?;
            resp.headers_mut()
                .append("Access-Control-Allow-Origin", "*");
            resp.headers_mut()
                .append("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            resp.headers_mut()
                .append("Access-Control-Allow-Headers", "content-type");
            Ok(resp)
        })
        .run(req, env)
        .await
}

async fn handle_ws(mut _req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    let pair = WebSocketPair::new()?;
    let server = pair.server;
    let client = pair.client;

    let my_id = NEXT_USER_ID.fetch_add(1, Ordering::Relaxed);

    // Accept the websocket connection
    server.accept()?;

    // Send welcome message
    let welcome = Message::Welcome { user_id: my_id };
    server.send_with_str(&serde_json::to_string(&welcome)?)?;

    // Set up the websocket handler
    wasm_bindgen_futures::spawn_local(async move {
        let event_stream = server.events().unwrap();
        let mut event_stream = Box::pin(event_stream);

        while let Some(event) = event_stream.next().await {
            match event {
                Ok(WebsocketEvent::Message(msg)) => {
                    if let Some(text) = msg.text() {
                        if let Ok(message) = serde_json::from_str::<Message>(&text) {
                            match message {
                                Message::PeerStateChange {
                                    from_id: _,
                                    to_id: _,
                                    state: _,
                                } => {
                                    // Forward peer state changes
                                    server.send_with_str(&text).unwrap_or_default();
                                }
                                Message::ConnectionRequest { to_id: _ }
                                | Message::RTCOffer { to_id: _, .. }
                                | Message::RTCAnswer { to_id: _, .. }
                                | Message::RTCCandidate { to_id: _, .. } => {
                                    // Forward connection-related messages
                                    server.send_with_str(&text).unwrap_or_default();
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Ok(WebsocketEvent::Close(_)) => break,
                _ => {}
            }
        }
    });

    Response::from_websocket(client)
}
