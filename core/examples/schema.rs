//! Regenerate the committed schema: `cargo run -p pal-core --example schema`.
fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/schema/config.schema.json");
    std::fs::write(path, pal_core::config::schema::json()).expect("write the committed schema");
    println!("wrote {path}");
}
