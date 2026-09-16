//! First launch: no config file yet, so write the commented template and put
//! the schema next to it, so what a new user opens to edit is a file that
//! explains itself and that an editor can validate. Nothing else happens on
//! first run yet. An existing file is left alone; the schema is refreshed
//! only when its bytes changed (a new release).

use pal_core::config::{schema, ConfigFile};

pub fn install() {
    let file = ConfigFile::locate();
    if !file.path().exists() {
        // An empty edit on a missing file creates it from `TEMPLATE`.
        match file.edit(|_| Ok(())) {
            Ok(()) => eprintln!("config\tcreated\t{}", file.path().display()),
            Err(e) => eprintln!("config\tcreate failed\t{e}"),
        }
    }
    if let Err(e) = schema::install(file.path()) {
        eprintln!("config\tschema install failed\t{e}");
    }
}
