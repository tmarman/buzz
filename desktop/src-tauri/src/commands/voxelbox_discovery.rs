use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

use crate::app_state::AppState;

const SURFACE_DISCOVERY_URL: &str = "http://localhost:1337/surfaces/";
const SURFACE_HELLO_URL: &str = "http://localhost:1337/api/hello";
const STEWARD_DISCOVERY_URL: &str = "http://localhost:1337/api/stewards";
const SPACE_DISCOVERY_URL: &str = "http://localhost:1337/api/spaces";
const SURFACE_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Deserialize)]
struct InstalledSurface {
    name: String,
    #[serde(default, alias = "org")]
    space: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    steward: String,
}

#[derive(Debug, Deserialize)]
struct SurfaceHandshake {
    #[serde(default)]
    surfaces: Vec<NegotiatedSurface>,
}

#[derive(Debug, Deserialize)]
struct NegotiatedSurface {
    id: String,
    #[serde(default)]
    space: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    owner_agent: String,
    render: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSurfaceDescriptor {
    name: String,
    space: String,
    description: String,
    owner_agent: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoxelboxSpaceSummary {
    name: String,
    #[serde(default)]
    description: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoxelboxAgentSummary {
    name: String,
    #[serde(alias = "type")]
    agent_type: String,
    description: String,
    org: String,
    #[serde(default)]
    avatar_url: Option<String>,
    #[serde(default)]
    has_voice: bool,
    #[serde(default)]
    voice_description: String,
}

#[derive(Debug, Deserialize)]
struct VoiceDesign {
    instruct: Option<String>,
    ref_text: Option<String>,
    seed_line: Option<String>,
}

/// Discover renderable surface descriptors through the native HTTP client.
///
/// Surface documents can navigate directly to the daemon in an iframe, but a
/// webview `fetch` is CORS-gated. Keeping the URL fixed here avoids accepting
/// an arbitrary native-fetch target while giving the frontend the same
/// graceful optional-discovery behavior. The canonical capability handshake is
/// attempted first; the legacy directory remains as a compatibility fallback.
#[tauri::command]
pub async fn discover_local_surfaces(
    state: State<'_, AppState>,
) -> Result<Vec<LocalSurfaceDescriptor>, String> {
    if let Ok(response) = state
        .http_client
        .post(SURFACE_HELLO_URL)
        .timeout(SURFACE_DISCOVERY_TIMEOUT)
        .json(&serde_json::json!({
            "client_id": "buzz-alpha",
            "client_type": "web",
            "proto": 1,
            "caps": ["descriptors"]
        }))
        .send()
        .await
    {
        if response.status().is_success() {
            if let Ok(handshake) = response.json::<SurfaceHandshake>().await {
                return Ok(negotiated_surface_descriptors(handshake.surfaces));
            }
        }
    }

    let response = state
        .http_client
        .get(SURFACE_DISCOVERY_URL)
        .timeout(SURFACE_DISCOVERY_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("surface discovery failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "surface discovery returned HTTP {}",
            response.status()
        ));
    }

    let surfaces = response
        .json::<Vec<InstalledSurface>>()
        .await
        .map_err(|error| format!("surface discovery response was invalid: {error}"))?;

    Ok(installed_surface_descriptors(surfaces))
}

/// Discover public Space names without returning local workspace paths, tools,
/// subscriptions, or other operator-only registry fields.
#[tauri::command]
pub async fn discover_voxelbox_spaces(
    state: State<'_, AppState>,
) -> Result<Vec<VoxelboxSpaceSummary>, String> {
    let response = state
        .http_client
        .get(SPACE_DISCOVERY_URL)
        .timeout(SURFACE_DISCOVERY_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("Voxelbox Space discovery failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Voxelbox Space discovery returned HTTP {}",
            response.status()
        ));
    }

    let spaces = response
        .json::<Vec<VoxelboxSpaceSummary>>()
        .await
        .map_err(|error| format!("Voxelbox Space discovery response was invalid: {error}"))?;

    Ok(voxelbox_space_summaries(spaces))
}

/// Discover configured Voxelbox agents without exposing local workspace paths.
///
/// These summaries describe agents available from the connected runtime; they
/// do not claim relay membership or grant execution authority.
#[tauri::command]
pub async fn discover_voxelbox_agents(
    state: State<'_, AppState>,
) -> Result<Vec<VoxelboxAgentSummary>, String> {
    let response = state
        .http_client
        .get(STEWARD_DISCOVERY_URL)
        .timeout(SURFACE_DISCOVERY_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("Voxelbox agent discovery failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Voxelbox agent discovery returned HTTP {}",
            response.status()
        ));
    }

    let agents = response
        .json::<Vec<VoxelboxAgentSummary>>()
        .await
        .map_err(|error| format!("Voxelbox agent discovery response was invalid: {error}"))?;

    let identity_root = voxelbox_identity_root();
    Ok(voxelbox_agent_summaries(agents)
        .into_iter()
        .map(|agent| enrich_agent_identity(agent, &identity_root))
        .collect())
}

fn installed_surface_descriptors(surfaces: Vec<InstalledSurface>) -> Vec<LocalSurfaceDescriptor> {
    surfaces
        .into_iter()
        .filter_map(|surface| {
            let name = surface.name.trim();
            (!name.is_empty()).then(|| LocalSurfaceDescriptor {
                name: name.to_string(),
                space: explicit_surface_space(&surface.space),
                description: surface.description.trim().to_string(),
                owner_agent: surface.steward.trim().to_string(),
            })
        })
        .collect()
}

fn negotiated_surface_descriptors(surfaces: Vec<NegotiatedSurface>) -> Vec<LocalSurfaceDescriptor> {
    surfaces
        .into_iter()
        .filter_map(|surface| {
            let name = surface.id.trim();
            (!name.is_empty() && surface.render.is_some()).then(|| LocalSurfaceDescriptor {
                name: name.to_string(),
                space: explicit_surface_space(&surface.space),
                description: surface.description.trim().to_string(),
                owner_agent: surface.owner_agent.trim().to_string(),
            })
        })
        .collect()
}

fn explicit_surface_space(space: &str) -> String {
    let space = space.trim();
    if space.is_empty() {
        "global".to_string()
    } else {
        space.to_string()
    }
}

fn voxelbox_space_summaries(spaces: Vec<VoxelboxSpaceSummary>) -> Vec<VoxelboxSpaceSummary> {
    spaces
        .into_iter()
        .filter_map(|mut space| {
            space.name = space.name.trim().to_string();
            space.description = space.description.trim().to_string();
            (!space.name.is_empty()).then_some(space)
        })
        .collect()
}

fn voxelbox_agent_summaries(agents: Vec<VoxelboxAgentSummary>) -> Vec<VoxelboxAgentSummary> {
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

fn voxelbox_identity_root() -> PathBuf {
    if let Ok(root) = std::env::var("VOXELBOX_HOME") {
        let root = root.trim();
        if !root.is_empty() {
            return PathBuf::from(root);
        }
    }

    dirs::home_dir().unwrap_or_default().join(".voxelbox")
}

fn enrich_agent_identity(
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
        agent.avatar_url = Some(format!(
            "http://localhost:1337/api/stewards/{}/avatar",
            agent.name
        ));
    }

    if identity_dir.join("voice.wav").is_file() {
        agent.has_voice = true;
        agent.voice_description = voice_description(&identity_dir);
    }

    agent
}

fn is_safe_agent_name(name: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_surfaces_default_legacy_entries_to_global() {
        let surfaces = installed_surface_descriptors(vec![
            InstalledSurface {
                name: "control".to_string(),
                space: String::new(),
                description: "Control plane".to_string(),
                steward: "weaver".to_string(),
            },
            InstalledSurface {
                name: "  ".to_string(),
                space: "voxelbox-ai".to_string(),
                description: String::new(),
                steward: String::new(),
            },
            InstalledSurface {
                name: "flow".to_string(),
                space: " tmarman ".to_string(),
                description: String::new(),
                steward: String::new(),
            },
        ]);

        assert_eq!(
            surfaces,
            vec![
                LocalSurfaceDescriptor {
                    name: "control".to_string(),
                    space: "global".to_string(),
                    description: "Control plane".to_string(),
                    owner_agent: "weaver".to_string(),
                },
                LocalSurfaceDescriptor {
                    name: "flow".to_string(),
                    space: "tmarman".to_string(),
                    description: String::new(),
                    owner_agent: String::new(),
                }
            ]
        );
    }

    #[test]
    fn negotiated_surfaces_keep_only_renderable_descriptors() {
        let surfaces = negotiated_surface_descriptors(vec![
            NegotiatedSurface {
                id: "control".to_string(),
                space: "global".to_string(),
                description: "Control plane".to_string(),
                owner_agent: "weaver".to_string(),
                render: Some(serde_json::json!({"route": "/surfaces/control/"})),
            },
            NegotiatedSurface {
                id: "headless".to_string(),
                space: "global".to_string(),
                description: String::new(),
                owner_agent: String::new(),
                render: None,
            },
        ]);

        assert_eq!(surfaces.len(), 1);
        assert_eq!(surfaces[0].name, "control");
    }

    #[test]
    fn voxelbox_agent_summaries_drop_empty_names_and_trim_public_fields() {
        let agents = voxelbox_agent_summaries(vec![
            VoxelboxAgentSummary {
                name: " weaver ".to_string(),
                agent_type: " orchestrator ".to_string(),
                description: " Connects work ".to_string(),
                org: " global ".to_string(),
                avatar_url: None,
                has_voice: false,
                voice_description: String::new(),
            },
            VoxelboxAgentSummary {
                name: " ".to_string(),
                agent_type: "workspace-steward".to_string(),
                description: String::new(),
                org: "voxelbox-ai".to_string(),
                avatar_url: None,
                has_voice: false,
                voice_description: String::new(),
            },
        ]);

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "weaver");
        assert_eq!(agents[0].agent_type, "orchestrator");
        assert_eq!(agents[0].description, "Connects work");
        assert_eq!(agents[0].org, "global");
    }

    #[test]
    fn agent_identity_enrichment_exposes_public_media_without_private_paths() {
        let root = tempfile::tempdir().expect("temp root");
        let identity_dir = root.path().join("agents/weaver/identity");
        std::fs::create_dir_all(&identity_dir).expect("identity dir");
        std::fs::write(identity_dir.join("avatar.png"), b"png").expect("avatar");
        std::fs::write(identity_dir.join("voice.wav"), b"wav").expect("voice");
        std::fs::write(
            identity_dir.join("voice_design.json"),
            br#"{"instruct":"Calm, connective delivery"}"#,
        )
        .expect("voice design");

        let agent = enrich_agent_identity(
            VoxelboxAgentSummary {
                name: "weaver".to_string(),
                agent_type: "orchestrator".to_string(),
                description: "Connects work".to_string(),
                org: "global".to_string(),
                avatar_url: None,
                has_voice: false,
                voice_description: String::new(),
            },
            root.path(),
        );

        assert_eq!(
            agent.avatar_url.as_deref(),
            Some("http://localhost:1337/api/stewards/weaver/avatar")
        );
        assert!(agent.has_voice);
        assert_eq!(agent.voice_description, "Calm, connective delivery");
    }
}
