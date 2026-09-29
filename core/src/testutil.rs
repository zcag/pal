//! A local HTTP server for tests that fetch (registries, packages, usage
//! batches): never the internet. One thread, `Connection: close`, routes by
//! path, `ETag`/`If-None-Match` honoured, every request recorded.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug)]
pub struct Route {
    pub status: u16,
    pub body: Vec<u8>,
    pub etag: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    /// Lowercased names.
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Clone)]
pub struct Server {
    pub base: String,
    routes: Arc<Mutex<HashMap<String, Route>>>,
    pub requests: Arc<Mutex<Vec<Request>>>,
}

impl Server {
    pub fn start() -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = Server { base, routes: Arc::default(), requests: Arc::default() };
        let s = server.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = s.answer(stream);
            }
        });
        server
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// Serve `body` at `path` with 200 (or `status`), and an ETag when given.
    pub fn put(&self, path: &str, status: u16, body: impl Into<Vec<u8>>, etag: Option<&str>) {
        self.routes.lock().unwrap().insert(path.to_string(), Route { status, body: body.into(), etag: etag.map(String::from) });
    }

    pub fn ok(&self, path: &str, body: impl Into<Vec<u8>>) {
        self.put(path, 200, body, None);
    }

    pub fn requests_to(&self, path: &str) -> Vec<Request> {
        self.requests.lock().unwrap().iter().filter(|r| r.path == path).cloned().collect()
    }

    fn answer(&self, mut stream: std::net::TcpStream) -> std::io::Result<()> {
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let mut parts = line.split_whitespace();
        let (method, path) = (parts.next().unwrap_or_default().to_string(), parts.next().unwrap_or_default().to_string());
        let mut headers = HashMap::new();
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h)? == 0 || h.trim().is_empty() {
                break;
            }
            if let Some((k, v)) = h.split_once(':') {
                headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
            }
        }
        let len = headers.get("content-length").and_then(|l| l.parse().ok()).unwrap_or(0);
        let mut body = vec![0; len];
        reader.read_exact(&mut body)?;
        let route = self.routes.lock().unwrap().get(&path).cloned();
        let inm = headers.get("if-none-match").cloned();
        self.requests.lock().unwrap().push(Request { method, path, headers, body });
        let (status, body, etag) = match route {
            Some(r) if r.etag.is_some() && r.etag == inm => (304, Vec::new(), r.etag),
            Some(r) => (r.status, r.body, r.etag),
            None => (404, b"not found".to_vec(), None),
        };
        let etag = etag.map(|e| format!("ETag: {e}\r\n")).unwrap_or_default();
        write!(stream, "HTTP/1.1 {status} X\r\nContent-Length: {}\r\n{etag}Connection: close\r\n\r\n", body.len())?;
        stream.write_all(&body)?;
        stream.flush()
    }
}

/// A minisign key pair, signing the way `minisign -S` does (prehashed).
pub struct Signer {
    pub public: String,
    pk: minisign::PublicKey,
    sk: minisign::SecretKey,
}

impl Signer {
    pub fn new() -> Signer {
        let kp = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        Signer { public: kp.pk.to_base64(), pk: kp.pk, sk: kp.sk }
    }

    /// The whole `.minisig` text over `data`.
    pub fn sign(&self, data: &[u8]) -> String {
        minisign::sign(Some(&self.pk), &self.sk, std::io::Cursor::new(data), None, None).unwrap().into_string()
    }
}
