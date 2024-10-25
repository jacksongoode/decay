use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub tls_enabled: bool,
    pub tls_port: u16,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3030),
            tls_enabled: env::var("TLS_ENABLED")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(false),
            tls_port: env::var("TLS_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3443),
            cert_path: env::var("CERT_PATH").ok(),
            key_path: env::var("KEY_PATH").ok(),
        }
    }
}
