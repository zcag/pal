//! Run the v1 migration on the config `PAL_CONFIG` names (the default
//! location otherwise), the way the app's first run does, and print the
//! result: `PAL_CONFIG=/tmp/x/config.toml cargo run -p pal-core --example
//! migrate [v1_repo]`. Point it at a copy to see what a migration would do;
//! `v1_repo` defaults to the `scripts` extension's own default.
fn main() {
    let file = pal_core::config::ConfigFile::locate();
    let v1_repo = std::env::args().nth(1).unwrap_or_else(|| "~/proj/pal-v1".into());
    match pal_core::config::migrate::migrate(&file, &v1_repo) {
        Ok(Some(m)) => {
            for n in &m.notes {
                eprintln!("migrate\t{n}");
            }
            print!("{}", m.config);
        }
        Ok(None) => eprintln!("migrate\tnot a v1 config\t{}", file.path().display()),
        Err(e) => {
            eprintln!("migrate\tfailed\t{e}");
            std::process::exit(1);
        }
    }
}
