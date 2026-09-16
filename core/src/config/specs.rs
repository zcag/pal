//! A declared setting (`pal.json`: `settings[]`, or `palettes.<key>.settings[]`,
//! as JSON) against a value an extension wants to write through
//! `settings.set`: [`find`] names the spec, [`check`] says whether the value
//! is what the spec's `kind` stores. The settings window writes through
//! the same file edit but validates in its own fields; this is the check
//! for a write that comes from code.

use serde_json::Value;

/// The spec with `id`, when the list declares one.
pub fn find<'a>(specs: &'a Value, id: &str) -> Option<&'a Value> {
    specs.as_array()?.iter().find(|s| s["id"] == id)
}

/// Whether `value` is what `spec`'s `kind` stores: a string for `text`,
/// `secret`, `hotkey`, `path` and `textarea`; one of the `options` ids for
/// `select`; a number within `min`/`max` for `number`; a bool for
/// `boolean`; an array of strings for `list`. A kind this side does not
/// know takes anything. `null` (unset) is always fine.
pub fn check(spec: &Value, value: &Value) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let kind = spec["kind"].as_str().unwrap_or("text");
    let want = |what: &str| Err(format!("a {kind} setting takes {what}, not {}", describe(value)));
    match kind {
        "text" | "secret" | "hotkey" | "path" | "textarea" => {
            if value.is_string() { Ok(()) } else { want("a string") }
        }
        "select" => {
            let Some(v) = value.as_str() else { return want("one of its options") };
            let ids: Vec<&str> = spec["options"].as_array().into_iter().flatten().filter_map(|o| o["id"].as_str()).collect();
            if ids.contains(&v) { Ok(()) } else { Err(format!("{v:?} is not one of the select's options ({})", ids.join(", "))) }
        }
        "number" => {
            let Some(n) = value.as_f64() else { return want("a number") };
            if let Some(min) = spec["min"].as_f64().filter(|m| n < *m) {
                return Err(format!("{n} is under the setting's minimum {min}"));
            }
            if let Some(max) = spec["max"].as_f64().filter(|m| n > *m) {
                return Err(format!("{n} is over the setting's maximum {max}"));
            }
            Ok(())
        }
        "boolean" => {
            if value.is_boolean() { Ok(()) } else { want("true or false") }
        }
        "list" => {
            if value.as_array().is_some_and(|a| a.iter().all(Value::is_string)) { Ok(()) } else { want("a list of strings") }
        }
        _ => Ok(()),
    }
}

fn describe(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn find_by_id() {
        let specs = json!([{ "id": "a", "kind": "text" }, { "id": "b", "kind": "number" }]);
        assert_eq!(find(&specs, "b").unwrap()["kind"], "number");
        assert!(find(&specs, "c").is_none());
        assert!(find(&json!(null), "a").is_none(), "no settings list at all");
    }

    #[test]
    fn each_kind_takes_its_value_and_refuses_the_rest() {
        let ok = |spec: Value, v: Value| check(&spec, &v).unwrap();
        let no = |spec: Value, v: Value| check(&spec, &v).unwrap_err();
        for kind in ["text", "secret", "hotkey", "path", "textarea"] {
            ok(json!({ "kind": kind }), json!("x"));
            assert!(no(json!({ "kind": kind }), json!(1)).contains("takes a string, not a number"));
        }
        ok(json!({ "kind": "number", "min": 1, "max": 10 }), json!(5));
        ok(json!({ "kind": "number" }), json!(2.5));
        assert!(no(json!({ "kind": "number", "min": 1 }), json!(0)).contains("under the setting's minimum 1"));
        assert!(no(json!({ "kind": "number", "max": 10 }), json!(11)).contains("over the setting's maximum 10"));
        assert!(no(json!({ "kind": "number" }), json!("5")).contains("takes a number"));
        ok(json!({ "kind": "boolean" }), json!(true));
        assert!(no(json!({ "kind": "boolean" }), json!("true")).contains("true or false"));
        let sel = json!({ "kind": "select", "options": [{ "id": "a", "title": "A" }, { "id": "b", "title": "B" }] });
        ok(sel.clone(), json!("b"));
        assert_eq!(no(sel.clone(), json!("c")), "\"c\" is not one of the select's options (a, b)");
        assert!(no(sel, json!(2)).contains("one of its options"));
        ok(json!({ "kind": "list" }), json!(["a", "b"]));
        ok(json!({ "kind": "list" }), json!([]));
        assert!(no(json!({ "kind": "list" }), json!(["a", 1])).contains("a list of strings"));
        assert!(no(json!({ "kind": "list" }), json!("a")).contains("a list of strings"));
        // Unset is fine for every kind; an unknown kind takes anything.
        ok(json!({ "kind": "number" }), Value::Null);
        ok(json!({ "kind": "colour" }), json!({ "r": 1 }));
        ok(json!({}), json!("no kind: text"));
    }
}
