use warp::Filter;

#[tokio::main]
async fn main() {
    env_logger::init();

    // Serve static files from www directory
    let www_dir = warp::fs::dir("www");

    // Basic health check route
    let health = warp::path!("health").map(|| "OK");

    // Combine routes
    let routes = www_dir
        .or(health)
        .with(warp::cors().allow_any_origin());

    println!("Starting server at https://localhost:3443");
    
    // Start the server with TLS
    warp::serve(routes)
        .tls()
        .cert_path("certs/cert.pem")
        .key_path("certs/key.pem")
        .run(([127, 0, 0, 1], 3443))
        .await;
} 