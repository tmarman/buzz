use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use nostr::Keys;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoxelboxAgentSummary {
    pub(super) name: String,
    #[serde(default, alias = "type")]
    pub(super) agent_type: String,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) org: String,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
    #[serde(default)]
    pub(super) has_voice: bool,
    #[serde(default)]
    pub(super) voice_description: String,
    #[serde(default)]
    pub(super) identity_ready: bool,
    #[serde(default)]
    pub(super) pubkey: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VoiceDesign {
    instruct: Option<String>,
    ref_text: Option<String>,
    seed_line: Option<String>,
}

pub(super) fn voxelbox_agent_summaries(
    agents: Vec<VoxelboxAgentSummary>,
) -> Vec<VoxelboxAgentSummary> {
    agents
        .into_iter()
        .filter_map(|mut agent| {
            agent.name = agent.name.trim().to_string();
            agent.agent_type = agent.agent_type.trim().to_string();
            agent.description = agent.description.trim().to_string();
            agent.org = agent.org.trim().to_string();
            (!agent.name.is_empty()).then_some(agent)
        })
        .collect()
}

pub(super) fn voxelbox_identity_root() -> PathBuf {
    if let Ok(root) = std::env::var("VOXELBOX_HOME") {
        let root = root.trim();
        if !root.is_empty() {
            return PathBuf::from(root);
        }
    }

    dirs::home_dir().unwrap_or_default().join(".voxelbox")
}

pub(super) fn enrich_agent_identity(
    mut agent: VoxelboxAgentSummary,
    voxelbox_root: &Path,
) -> VoxelboxAgentSummary {
    if !is_safe_agent_name(&agent.name) {
        return agent;
    }

    let identity_dir = voxelbox_root
        .join("agents")
        .join(&agent.name)
        .join("identity");
    if identity_dir.join("avatar.png").is_file() {
        if let Ok(bytes) = std::fs::read(identity_dir.join("avatar.png")) {
            agent.avatar_url = Some(format!(
                "data:image/png;base64,{}",
                BASE64_STANDARD.encode(bytes)
            ));
        }
    }

    if identity_dir.join("voice.wav").is_file() {
        agent.has_voice = true;
        agent.voice_description = voice_description(&identity_dir);
    }
    let nostr_dir = identity_dir.join("nostr");
    if nostr_dir.join("credential").is_file() {
        if let Ok(nsec) = std::fs::read_to_string(nostr_dir.join("nsec")) {
            if let Ok(keys) = Keys::parse(nsec.trim()) {
                agent.identity_ready = true;
                agent.pubkey = Some(keys.public_key().to_hex());
            }
        }
    }

    agent
}

pub(super) fn is_safe_agent_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn voice_description(identity_dir: &Path) -> String {
    let Ok(data) = std::fs::read(identity_dir.join("voice_design.json")) else {
        return String::new();
    };
    let Ok(design) = serde_json::from_slice::<VoiceDesign>(&data) else {
        return String::new();
    };

    [design.instruct, design.ref_text, design.seed_line]
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}
