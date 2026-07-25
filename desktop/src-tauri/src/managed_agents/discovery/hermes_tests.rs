use super::{
    known_acp_runtime_exact, managed_agent_avatar_url, normalize_agent_args, HERMES_AVATAR_URL,
};

#[test]
fn runtime_contract_is_acp_native() {
    let runtime = known_acp_runtime_exact("hermes").expect("Hermes runtime must be registered");

    assert_eq!(
        normalize_agent_args("hermes", Vec::new()),
        vec!["acp".to_string()],
        "desktop launches must enter Hermes' ACP stdio mode"
    );
    assert_eq!(
        managed_agent_avatar_url("/Users/test/.local/bin/hermes"),
        Some(HERMES_AVATAR_URL.to_string())
    );
    assert_eq!(
        runtime.cli_install_commands,
        &["curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"]
    );
    assert_eq!(
        runtime.cli_install_commands_windows,
        &["powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"iex (irm https://hermes-agent.nousresearch.com/install.ps1)\""]
    );
    assert!(runtime.adapter_install_commands.is_empty());
    assert!(runtime.supports_acp_model_switching);
    assert_eq!(runtime.model_env_var, None);
    assert_eq!(runtime.provider_env_var, None);
    assert!(runtime.required_normalized_fields.is_empty());
    assert_eq!(
        runtime.auth_probe_args,
        Some(&["hermes", "config", "get", "model.provider"][..])
    );
    assert_eq!(
        runtime.login_hint,
        Some("Run `hermes model` to configure a provider and model.")
    );
}
