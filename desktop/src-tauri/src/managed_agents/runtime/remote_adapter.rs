use std::process::Command;

use super::super::readiness::EffectiveHarnessDescriptor;

pub(super) fn load_bearer_token(
    descriptor: &EffectiveHarnessDescriptor,
) -> Result<Option<String>, String> {
    if super::super::discovery::normalize_command_identity(&descriptor.command) != "buzz-a2a-acp" {
        return Ok(None);
    }
    match (
        descriptor.env.get("BUZZ_A2A_AGENT_RECORD"),
        descriptor.env.get("BUZZ_A2A_BEARER_ENDPOINT"),
    ) {
        (Some(record_url), Some(endpoint)) => {
            crate::commands::load_remote_agency_bearer_token(record_url, endpoint)
        }
        _ => Ok(None),
    }
}

pub(super) fn apply_bearer_token(command: &mut Command, token: Option<String>) {
    command.env_remove("BUZZ_A2A_BEARER_TOKEN");
    if let Some(token) = token {
        command.env("BUZZ_A2A_BEARER_TOKEN", token);
    }
}

pub(super) fn apply_extensions_json(command: &mut Command, value: Option<&str>) {
    command.env_remove("BUZZ_A2A_EXTENSIONS_JSON");
    if let Some(value) = value {
        command.env("BUZZ_A2A_EXTENSIONS_JSON", value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_config_is_explicit_and_does_not_inherit() {
        let mut command = Command::new("buzz-a2a-acp");
        command.env("BUZZ_A2A_EXTENSIONS_JSON", "ambient");

        apply_extensions_json(&mut command, None);
        assert_eq!(
            command
                .get_envs()
                .find(|(key, _)| *key == "BUZZ_A2A_EXTENSIONS_JSON")
                .and_then(|(_, value)| value),
            None
        );

        apply_extensions_json(&mut command, Some(r#"{"urn:example":{}}"#));
        assert_eq!(
            command
                .get_envs()
                .find(|(key, _)| *key == "BUZZ_A2A_EXTENSIONS_JSON")
                .and_then(|(_, value)| value)
                .and_then(|value| value.to_str()),
            Some(r#"{"urn:example":{}}"#)
        );
    }
}
