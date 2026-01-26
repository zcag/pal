use std::io::{self, BufRead, Write};

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "run" => run_stdin(input.unwrap_or("")),
        _ => {
            eprintln!("stdin: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn run_stdin(items: &str) -> String {
    let lines: Vec<&str> = items.lines().collect();

    if lines.is_empty() {
        return String::new();
    }

    // Display numbered items
    for (i, line) in lines.iter().enumerate() {
        if let Ok(item) = serde_json::from_str::<serde_json::Value>(line) {
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or(line);
            println!("{:3}. {}", i + 1, name);
        } else {
            println!("{:3}. {}", i + 1, line);
        }
    }

    // Prompt for selection
    print!("\nSelect [1-{}]: ", lines.len());
    let _ = io::stdout().flush();

    let stdin = io::stdin();
    let mut input = String::new();

    if stdin.lock().read_line(&mut input).is_err() {
        return String::new();
    }

    let selection: usize = input.trim().parse().unwrap_or(0);

    if selection > 0 && selection <= lines.len() {
        lines[selection - 1].to_string()
    } else {
        String::new()
    }
}
