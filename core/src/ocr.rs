//! Text out of an image: the Vision framework on macOS
//! (`VNRecognizeTextRequest`, accurate level, language detected), the
//! `tesseract` command on Linux when it is installed. A PDF is its first
//! page, rendered by `pdftoppm` when installed (both platforms) or by
//! `sips` on macOS. The result is the recognised lines, top to bottom,
//! joined by newlines; an image with no text is an empty string.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// No recogniser on this machine (Linux without `tesseract`), or no
    /// way to render the PDF.
    #[error("OCR unavailable: {0}")]
    Unavailable(String),
    #[error("OCR failed: {0}")]
    Failed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Whether a recogniser is there at all, without running one.
pub fn available() -> bool {
    platform::available()
}

/// The text in the image (PNG, JPEG, TIFF, HEIC, whatever the OS decodes;
/// a PDF's first page).
pub fn image(path: &Path) -> Result<String> {
    if !path.is_file() {
        return Err(Error::Failed(format!("no such file {}", path.display())));
    }
    if is_pdf(path) {
        let png = render_pdf(path)?;
        let r = platform::recognize(png.path());
        return r;
    }
    platform::recognize(path)
}

/// The text in image bytes: written to a temporary file first, since both
/// recognisers take a path.
pub fn bytes(data: &[u8]) -> Result<String> {
    let tmp = tempfile::Builder::new().prefix("pal-ocr-").suffix(".png").tempfile()?;
    std::fs::write(tmp.path(), data)?;
    image(tmp.path())
}

fn is_pdf(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

/// The first page as a PNG in a temporary file: `pdftoppm` at 200 dpi
/// (poppler; Homebrew or the distribution), else `sips` on macOS (72 dpi,
/// upsampled so the small print is still legible to Vision).
fn render_pdf(path: &Path) -> Result<tempfile::NamedTempFile> {
    let out = tempfile::Builder::new().prefix("pal-ocr-").suffix(".png").tempfile()?;
    if which("pdftoppm") {
        // `-singlefile` writes `<prefix>.png`; the prefix is the temp path without its extension.
        let prefix: PathBuf = out.path().with_extension("");
        let st = Command::new("pdftoppm").args(["-png", "-r", "200", "-f", "1", "-l", "1", "-singlefile"]).arg(path).arg(&prefix).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status()?;
        if st.success() && out.path().is_file() {
            return Ok(out);
        }
        return Err(Error::Failed("pdftoppm could not render the first page".into()));
    }
    if cfg!(target_os = "macos") {
        let st = Command::new("sips").args(["-s", "format", "png", "--resampleWidth", "1600"]).arg(path).arg("--out").arg(out.path()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status()?;
        if st.success() {
            return Ok(out);
        }
        return Err(Error::Failed("sips could not render the first page".into()));
    }
    Err(Error::Unavailable("rendering a PDF needs pdftoppm (poppler)".into()))
}

fn which(bin: &str) -> bool {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    // The app under launchd has a bare PATH; where Homebrew and the distributions put tools.
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    dirs.iter().any(|d| d.join(bin).is_file())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::runtime::AnyObject;
    use objc2::{sel, AnyThread};
    use objc2_foundation::{NSArray, NSDictionary, NSObjectProtocol, NSString, NSURL};
    use objc2_vision::{VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel};

    pub fn available() -> bool {
        true
    }

    pub fn recognize(path: &Path) -> Result<String> {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let options: objc2::rc::Retained<NSDictionary<objc2_vision::VNImageOption, AnyObject>> = NSDictionary::new();
        // SAFETY: the options dictionary is empty, so its generic type is trivially right.
        let handler = unsafe { VNImageRequestHandler::initWithURL_options(VNImageRequestHandler::alloc(), &url, &options) };
        let req = VNRecognizeTextRequest::new();
        req.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        req.setUsesLanguageCorrection(true);
        // macOS 13+; the selector is checked so 11 and 12 fall back to the system language.
        if req.respondsToSelector(sel!(setAutomaticallyDetectsLanguage:)) {
            req.setAutomaticallyDetectsLanguage(true);
        }
        let reqs: [&VNRequest; 1] = [&req];
        handler.performRequests_error(&NSArray::from_slice(&reqs)).map_err(|e| Error::Failed(e.localizedDescription().to_string()))?;
        let lines: Vec<String> = req
            .results()
            .map(|obs| obs.iter().filter_map(|o| o.topCandidates(1).iter().next().map(|c| c.string().to_string())).collect())
            .unwrap_or_default();
        Ok(lines.join("\n"))
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    pub fn available() -> bool {
        which("tesseract")
    }

    /// `tesseract <image> stdout`: the default page segmentation and the
    /// installed languages' default (English unless configured).
    pub fn recognize(path: &Path) -> Result<String> {
        if !available() {
            return Err(Error::Unavailable("tesseract is not installed".into()));
        }
        let out = Command::new("tesseract").arg(path).arg("stdout").stdin(Stdio::null()).stderr(Stdio::piped()).output()?;
        if !out.status.success() {
            return Err(Error::Failed(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        Ok(String::from_utf8_lossy(&out.stdout).lines().map(str::trim_end).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PNG with `text` drawn in a large system font, black on white,
    /// through AppKit over `osascript` (no font rasteriser ships in pal);
    /// `None` where that is not possible (Linux, a headless CI).
    fn render_text(text: &str, out: &Path) -> Option<()> {
        if !cfg!(target_os = "macos") {
            return None;
        }
        let js = format!(
            r#"ObjC.import('AppKit');
            const size = $.NSMakeSize(900, 200);
            const img = $.NSImage.alloc.initWithSize(size);
            img.lockFocus;
            $.NSColor.whiteColor.set; $.NSBezierPath.fillRect($.NSMakeRect(0, 0, 900, 200));
            const attrs = $.NSMutableDictionary.alloc.init;
            attrs.setObjectForKey($.NSFont.fontWithNameSize('Helvetica', 64), $.NSFontAttributeName);
            attrs.setObjectForKey($.NSColor.blackColor, $.NSForegroundColorAttributeName);
            $.NSString.alloc.initWithUTF8String({text:?}).drawAtPointWithAttributes($.NSMakePoint(40, 60), attrs);
            img.unlockFocus;
            const rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
            const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.alloc.init);
            png.writeToFileAtomically({out:?}, true);"#,
            text = text,
            out = out.to_string_lossy()
        );
        let st = Command::new("osascript").args(["-l", "JavaScript", "-e", &js]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().ok()?;
        (st.success() && out.is_file()).then_some(())
    }

    #[test]
    fn recognizes_rendered_text() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("hello.png");
        if render_text("HELLO PAL 483920", &png).is_none() || !available() {
            eprintln!("ocr: no way to render text here, live assertion skipped");
            return;
        }
        let text = image(&png).unwrap();
        assert!(text.contains("HELLO") && text.contains("483920"), "got {text:?}");
        // The bytes path lands on the same recogniser.
        assert_eq!(bytes(&std::fs::read(&png).unwrap()).unwrap(), text);
        // A PDF of the same picture (sips converts) reads through the first-page render.
        let pdf = dir.path().join("hello.pdf");
        let st = Command::new("sips").args(["-s", "format", "pdf"]).arg(&png).arg("--out").arg(&pdf).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
        if st.is_ok_and(|s| s.success()) && pdf.is_file() {
            let text = image(&pdf).unwrap();
            assert!(text.contains("HELLO") && text.contains("483920"), "pdf: got {text:?}");
        }
    }

    #[test]
    fn a_missing_file_is_a_failure_not_a_crash() {
        assert!(matches!(image(Path::new("/nonexistent/x.png")), Err(Error::Failed(_))));
        assert!(is_pdf(Path::new("/a/b.PDF")) && !is_pdf(Path::new("/a/b.png")));
    }
}
