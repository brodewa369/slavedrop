// Verify parse_x_username port matches the JS implementation behavior.
use slavedrop_lib::parse_x_username_public;

#[test]
fn parse_x_cases() {
    let cases = vec![
        ("username", "username"),
        ("@username", "username"),
        ("https://x.com/username", "username"),
        ("https://twitter.com/username?x=1", "username"),
        ("https://x.com/https://x.com/AaronnoShuvo", "AaronnoShuvo"),
        ("", ""),
        ("  ", ""),
        ("https://x.com/", "xcom"), // faithful to JS original (quirk preserved)
        ("@a_b_c123", "a_b_c123"),
    ];
    for (input, expected) in cases {
        let got = parse_x_username_public(&serde_json::Value::String(input.to_string()));
        assert_eq!(got, expected, "input={input:?} expected={expected} got={got}");
    }
}
