use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::commands::agency_runtime_endpoint;

const SURFACE_SESSION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MintSurfaceSessionRequest {
    #[serde(default)]
    agency_id: String,
    surface_id: String,
    #[serde(default)]
    space: Option<String>,
    #[serde(default)]
    project_ref: Option<String>,
    #[serde(default)]
    actions: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceSession {
    token: String,
    #[serde(alias = "expires_at")]
    expires_at: Option<String>,
    #[serde(default, alias = "allowed_actions")]
    actions: Vec<String>,
}

/// Mint a short-lived capability token for a mounted provider surface.
///
/// The token is returned only to the native shell and is delivered to the
/// validated iframe through the surface handshake; it is never placed in the
/// surface URL or persisted by Buzz. Providers that require enrollment or an
/// operator credential may reject this loopback request, in which case the
/// caller keeps the surface read-only.
#[tauri::command]
pub async fn mint_surface_session(
    app: AppHandle,
    state: State<'_, AppState>,
    request: MintSurfaceSessionRequest,
) -> Result<SurfaceSession, String> {
    let surface_id = request.surface_id.trim();
    if surface_id.is_empty() {
        return Err("Surface session requires a surface id".to_string());
    }
    if request.actions.is_empty() {
        return Err("Surface session requires at least one action".to_string());
    }
    let actions = request
        .actions
        .into_iter()
        .map(|action| action.trim().to_string())
        .filter(|action| !action.is_empty())
        .collect::<Vec<_>>();
    if actions.is_empty() {
        return Err("Surface session requires at least one action".to_string());
    }

    let body = serde_json::json!({
        "actor_kind": "surface",
        "surface_id": surface_id,
        "client_id": "buzz",
        "space": request.space.as_deref().map(str::trim).filter(|value| !value.is_empty()),
        "project_ref": request.project_ref.as_deref().map(str::trim).filter(|value| !value.is_empty()),
        "allowed_actions": actions,
        "ttl_seconds": 300,
    });
    let mut last_error = None;
    for path in [
        "/api/agency/surface-sessions",
        "/api/auth/interaction-session",
    ] {
        let response = match state
            .media_fetch_client
            .post(agency_runtime_endpoint(&app, path)?)
            .timeout(SURFACE_SESSION_TIMEOUT)
            .json(&body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };
        if response.status().is_success() {
            return response
                .json::<SurfaceSession>()
                .await
                .map_err(|error| format!("Surface session response was invalid: {error}"));
        }
        last_error = Some(format!("HTTP {}", response.status()));
    }
    Err(format!(
        "Surface session request failed: {}",
        last_error.unwrap_or_else(|| "no compatible endpoint".to_string())
    ))
}
