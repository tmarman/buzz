use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use nostr::{Keys, ToBech32};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::managed_agents::{
    BackendKind, CreateManagedAgentRequest, ManagedAgentSummary, RespondTo,
};

const SURFACE_DISCOVERY_URL: &str = "http://localhost:1337/surfaces/";
const SURFACE_HELLO_URL: &str = "http://localhost:1337/api/hello";
const STEWARD_DISCOVERY_URL: &str = "http://localhost:1337/api/stewards";
const AGENCY_ENROLLMENT_URL: &str = "http://localhost:1337/api/agency/enrollments";
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
    #[serde(default)]
    icon: String,
    #[serde(default)]
    category: String,
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
    #[serde(default)]
    icon: String,
    render: Option<NegotiatedRender>,
}

#[derive(Debug, Deserialize)]
struct NegotiatedRender {
    #[serde(default)]
    category: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSurfaceDescriptor {
    name: String,
    space: String,
    description: String,
    owner_agent: String,
    icon: String,
    category: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoxelboxSpaceSummary {
    name: String,
    #[serde(default, alias = "display_name")]
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    stewards: Vec<String>,
    #[serde(default)]
    surfaces: Vec<String>,
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
    #[serde(default)]
    identity_ready: bool,
    #[serde(default)]
    pubkey: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VoiceDesign {
    instruct: Option<String>,
    ref_text: Option<String>,
    seed_line: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoxelboxEnrollmentResult {
    steward: String,
    npub: String,
    pubkey: String,
    state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinVoxelboxAgentResult {
    agent: ManagedAgentSummary,
    enrollment: VoxelboxEnrollmentResult,
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
    scope: Option<String>,
) -> Result<Vec<LocalSurfaceDescriptor>, String> {
    let scope = normalize_surface_scope(scope.as_deref())?;
    if let Ok(response) = state
        .http_client
        .post(SURFACE_HELLO_URL)
        .query(&[("scope", scope.as_str())])
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
        .query(&[("scope", scope.as_str())])
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

/// Imports the Buzz-minted identity into a configured local steward.
///
/// The fixed loopback target keeps the nsec out of browser fetches and prevents
/// this command from becoming an arbitrary native POST primitive.
#[tauri::command]
pub async fn import_voxelbox_agent_identity(
    state: State<'_, AppState>,
    steward: String,
    nsec: String,
    owner_auth_tag: String,
    replace_existing: bool,
) -> Result<VoxelboxEnrollmentResult, String> {
    let owner_auth_tag = serde_json::from_str::<serde_json::Value>(&owner_auth_tag)
        .map_err(|_| "owner auth tag is invalid".to_string())?;
    enroll_voxelbox_agent(
        state.inner(),
        &steward,
        &nsec,
        owner_auth_tag,
        replace_existing,
    )
    .await
}

/// Adopts a configured steward's existing identity into Buzz.
///
/// Private key material is read and used only inside the native process. When
/// a steward does not have an identity yet, the same keypair is minted once,
/// persisted by Foundry, and stored by Buzz as the managed-agent identity.
#[tauri::command]
pub async fn join_voxelbox_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    steward: String,
    avatar_url: Option<String>,
) -> Result<JoinVoxelboxAgentResult, String> {
    let steward = steward.trim().to_string();
    if !is_safe_agent_name(&steward) {
        return Err("invalid Voxelbox steward".to_string());
    }

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
    let agent = voxelbox_agent_summaries(agents)
        .into_iter()
        .find(|candidate| candidate.name == steward)
        .ok_or_else(|| "unknown Voxelbox steward".to_string())?;
    let agent = enrich_agent_identity(agent, &voxelbox_identity_root());

    let nsec_path = voxelbox_identity_root()
        .join("agents")
        .join(&steward)
        .join("identity")
        .join("nostr")
        .join("nsec");
    let (keys, had_existing_identity) = match std::fs::read_to_string(&nsec_path) {
        Ok(nsec) => (
            Keys::parse(nsec.trim())
                .map_err(|_| "stored Voxelbox identity is invalid".to_string())?,
            true,
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Keys::generate(), false),
        Err(_) => return Err("could not read the Voxelbox identity".to_string()),
    };
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|error| format!("failed to encode Voxelbox identity: {error}"))?;

    let mut env_vars = BTreeMap::new();
    env_vars.insert("VOXELBOX_STEWARD".to_string(), steward.clone());
    env_vars.insert("VOXELBOX_BUZZ_MODE".to_string(), "conversation".to_string());
    let published_avatar_url = avatar_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(agent.avatar_url);
    let create_input = CreateManagedAgentRequest {
        name: steward.clone(),
        persona_id: None,
        team_id: None,
        relay_url: None,
        acp_command: Some("buzz-acp".to_string()),
        agent_command: Some("voxelbox-agent".to_string()),
        harness_override: true,
        agent_args: Vec::new(),
        mcp_command: None,
        turn_timeout_seconds: None,
        idle_timeout_seconds: None,
        max_turn_duration_seconds: None,
        parallelism: None,
        system_prompt: (!agent.description.is_empty()).then_some(agent.description),
        avatar_url: published_avatar_url,
        model: None,
        provider: None,
        env_vars,
        spawn_after_create: false,
        start_on_app_launch: true,
        backend: BackendKind::Local,
        respond_to: Some(RespondTo::OwnerOnly),
        respond_to_allowlist: Vec::new(),
        relay_mesh: None,
    };

    let created = crate::commands::agents::create_managed_agent_with_keys(
        create_input,
        app.clone(),
        state.inner(),
        Some(keys),
    )
    .await?;
    let owner_auth_tag = created
        .owner_auth_tag
        .as_deref()
        .ok_or_else(|| "Buzz did not create an owner attestation".to_string())
        .and_then(|value| {
            serde_json::from_str::<serde_json::Value>(value)
                .map_err(|_| "Buzz created an invalid owner attestation".to_string())
        });
    let enrollment = match owner_auth_tag {
        Ok(owner_auth_tag) => {
            enroll_voxelbox_agent(
                state.inner(),
                &steward,
                &nsec,
                owner_auth_tag,
                had_existing_identity,
            )
            .await
        }
        Err(error) => Err(error),
    };
    let enrollment = match enrollment {
        Ok(enrollment) => enrollment,
        Err(error) => {
            let _ = crate::commands::agents::delete_managed_agent(
                created.agent.pubkey.clone(),
                Some(true),
                app,
            )
            .await;
            return Err(error);
        }
    };

    Ok(JoinVoxelboxAgentResult {
        agent: created.agent,
        enrollment,
    })
}

async fn enroll_voxelbox_agent(
    state: &AppState,
    steward: &str,
    nsec: &str,
    owner_auth_tag: serde_json::Value,
    replace_existing: bool,
) -> Result<VoxelboxEnrollmentResult, String> {
    let response = state
        .http_client
        .post(AGENCY_ENROLLMENT_URL)
        .timeout(SURFACE_DISCOVERY_TIMEOUT)
        .json(&serde_json::json!({
            "steward": steward,
            "nsec": nsec,
            "ownerAuthTag": owner_auth_tag,
            "replaceExisting": replace_existing,
        }))
        .send()
        .await
        .map_err(|error| format!("Voxelbox enrollment failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "Voxelbox enrollment returned HTTP {status}: {}",
            detail.trim()
        ));
    }

    response
        .json::<VoxelboxEnrollmentResult>()
        .await
        .map_err(|error| format!("Voxelbox enrollment response was invalid: {error}"))
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
                icon: surface.icon.trim().to_string(),
                category: surface.category.trim().to_string(),
            })
        })
        .collect()
}

fn negotiated_surface_descriptors(surfaces: Vec<NegotiatedSurface>) -> Vec<LocalSurfaceDescriptor> {
    surfaces
        .into_iter()
        .filter_map(|surface| {
            let name = surface.id.trim();
            let category = surface
                .render
                .as_ref()
                .map(|render| render.category.trim().to_string())
                .unwrap_or_default();
            surface
                .render
                .is_some()
                .then(|| LocalSurfaceDescriptor {
                    name: name.to_string(),
                    space: explicit_surface_space(&surface.space),
                    description: surface.description.trim().to_string(),
                    owner_agent: surface.owner_agent.trim().to_string(),
                    icon: surface.icon.trim().to_string(),
                    category,
                })
                .filter(|_| !name.is_empty())
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

fn normalize_surface_scope(scope: Option<&str>) -> Result<String, String> {
    let scope = scope.unwrap_or("global").trim();
    if scope == "global" {
        return Ok(scope.to_string());
    }
    if let Some(space) = scope.strip_prefix("space:") {
        let space = space.trim();
        if !space.is_empty() {
            return Ok(format!("space:{space}"));
        }
    }
    Err("surface scope must be global or space:<id>".to_string())
}

fn voxelbox_space_summaries(spaces: Vec<VoxelboxSpaceSummary>) -> Vec<VoxelboxSpaceSummary> {
    spaces
        .into_iter()
        .filter_map(|mut space| {
            space.name = space.name.trim().to_string();
            space.display_name = space.display_name.trim().to_string();
            space.description = space.description.trim().to_string();
            space.stewards = space
                .stewards
                .into_iter()
                .map(|steward| steward.trim().to_string())
                .filter(|steward| !steward.is_empty())
                .collect();
            space.surfaces = space
                .surfaces
                .into_iter()
                .map(|surface| surface.trim().to_string())
                .filter(|surface| !surface.is_empty())
                .collect();
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
    use nostr::ToBech32;

    #[test]
    fn installed_surfaces_default_legacy_entries_to_global() {
        let surfaces = installed_surface_descriptors(vec![
            InstalledSurface {
                name: "control".to_string(),
                space: String::new(),
                description: "Control plane".to_string(),
                steward: "weaver".to_string(),
                icon: "sliders-horizontal".to_string(),
                category: "core".to_string(),
            },
            InstalledSurface {
                name: "  ".to_string(),
                space: "voxelbox-ai".to_string(),
                description: String::new(),
                steward: String::new(),
                icon: String::new(),
                category: String::new(),
            },
            InstalledSurface {
                name: "flow".to_string(),
                space: " tmarman ".to_string(),
                description: String::new(),
                steward: String::new(),
                icon: String::new(),
                category: String::new(),
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
                    icon: "sliders-horizontal".to_string(),
                    category: "core".to_string(),
                },
                LocalSurfaceDescriptor {
                    name: "flow".to_string(),
                    space: "tmarman".to_string(),
                    description: String::new(),
                    owner_agent: String::new(),
                    icon: String::new(),
                    category: String::new(),
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
                icon: "sliders-horizontal".to_string(),
                render: Some(NegotiatedRender {
                    category: "core".to_string(),
                }),
            },
            NegotiatedSurface {
                id: "headless".to_string(),
                space: "global".to_string(),
                description: String::new(),
                owner_agent: String::new(),
                icon: String::new(),
                render: None,
            },
        ]);

        assert_eq!(surfaces.len(), 1);
        assert_eq!(surfaces[0].name, "control");
    }

    #[test]
    fn surface_scope_defaults_to_global_and_rejects_invalid_values() {
        assert_eq!(normalize_surface_scope(None).as_deref(), Ok("global"));
        assert_eq!(
            normalize_surface_scope(Some(" space:voxelbox-ai ")).as_deref(),
            Ok("space:voxelbox-ai")
        );
        assert!(normalize_surface_scope(Some("space:")).is_err());
        assert!(normalize_surface_scope(Some("voxelbox-ai")).is_err());
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
                identity_ready: false,
                pubkey: None,
            },
            VoxelboxAgentSummary {
                name: " ".to_string(),
                agent_type: "workspace-steward".to_string(),
                description: String::new(),
                org: "voxelbox-ai".to_string(),
                avatar_url: None,
                has_voice: false,
                voice_description: String::new(),
                identity_ready: false,
                pubkey: None,
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
        let nostr_dir = identity_dir.join("nostr");
        std::fs::create_dir_all(&nostr_dir).expect("nostr dir");
        let keys = Keys::generate();
        let pubkey = keys.public_key().to_hex();
        let nsec = keys.secret_key().to_bech32().expect("nsec");
        std::fs::write(nostr_dir.join("nsec"), nsec).expect("nsec");
        std::fs::write(nostr_dir.join("credential"), b"credential").expect("credential");
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
                identity_ready: false,
                pubkey: None,
            },
            root.path(),
        );

        assert_eq!(
            agent.avatar_url.as_deref(),
            Some("data:image/png;base64,cG5n")
        );
        assert!(agent.has_voice);
        assert!(agent.identity_ready);
        assert_eq!(agent.pubkey.as_deref(), Some(pubkey.as_str()));
        assert_eq!(agent.voice_description, "Calm, connective delivery");
    }
}
