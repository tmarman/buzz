use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::commands::agency_runtime_endpoint;
const VOXELBOX_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize)]
struct InteractionSession {
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureVoxelboxTaskRequest {
    space: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    project_ref: String,
    source_ref: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVoxelboxWorkRequest {
    space: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    project_ref: String,
    source_ref: String,
    thread_ref: String,
    idempotency_key: String,
    participant_id: String,
    #[serde(default = "default_work_mode")]
    mode: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapturedVoxelboxTask {
    id: String,
    title: String,
    status: String,
    priority: String,
    #[serde(alias = "org_name")]
    space: String,
    #[serde(default, alias = "project_ref")]
    project_ref: String,
    #[serde(default, alias = "source_ref")]
    source_ref: String,
    revision: u64,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartedVoxelboxWork {
    task: CapturedVoxelboxTask,
    #[serde(alias = "thread_ref")]
    thread_ref: String,
    #[serde(default, alias = "dispatch_id")]
    dispatch_id: String,
    created: bool,
}

/// Capture one delivered Buzz message as a Voxelbox Board task.
///
/// The browser supplies content and the already-associated Space, but never a
/// daemon credential or target URL. The native shell exchanges the local
/// operator credential for a five-minute host session scoped to that Space,
/// then uses only the narrow `work.capture` grant to create the task.
#[tauri::command]
pub async fn capture_voxelbox_task(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CaptureVoxelboxTaskRequest,
) -> Result<CapturedVoxelboxTask, String> {
    let request = normalize_capture_request(request)?;
    let session = mint_host_session(
        &app,
        state.inner(),
        &request.space,
        &request.project_ref,
        &["work.capture"],
    )
    .await?;
    capture_task(&app, state.inner(), &session.token, &request).await
}

/// Start self-directed work in an explicit Buzz conversation.
///
/// Capture and start share one short-lived host session. Retrying after either
/// network step is safe: task capture deduplicates by source reference and the
/// work endpoint deduplicates by the supplied action key.
#[tauri::command]
pub async fn start_voxelbox_work(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartVoxelboxWorkRequest,
) -> Result<StartedVoxelboxWork, String> {
    let request = normalize_start_request(request)?;
    let capture = CaptureVoxelboxTaskRequest {
        space: request.space.clone(),
        title: request.title.clone(),
        description: request.description.clone(),
        project_ref: request.project_ref.clone(),
        source_ref: request.source_ref.clone(),
    };
    let session = mint_host_session(
        &app,
        state.inner(),
        &request.space,
        &request.project_ref,
        &["work.capture", "work.start"],
    )
    .await?;
    let task = capture_task(&app, state.inner(), &session.token, &capture).await?;
    let response = state
        .media_fetch_client
        .post(agency_runtime_endpoint(&app, "/api/work/start")?)
        .timeout(VOXELBOX_REQUEST_TIMEOUT)
        .bearer_auth(session.token)
        .json(&serde_json::json!({
            "idempotency_key": request.idempotency_key,
            "space": request.space,
            "project_ref": request.project_ref,
            "task_id": task.id,
            "task_revision": task.revision,
            "thread_ref": request.thread_ref,
            "mode": request.mode,
            "participant": {
                "kind": "self",
                "id": request.participant_id,
            },
            "source": {
                "kind": "buzz_message",
                "url": request.source_ref,
                "label": request.title,
            },
        }))
        .send()
        .await
        .map_err(|error| format!("Voxelbox work start failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Voxelbox work start", response).await);
    }

    response
        .json::<StartedVoxelboxWork>()
        .await
        .map_err(|error| format!("Voxelbox work response was invalid: {error}"))
}

async fn mint_host_session(
    app: &AppHandle,
    state: &AppState,
    space: &str,
    project_ref: &str,
    allowed_actions: &[&str],
) -> Result<InteractionSession, String> {
    let operator_token = read_voxelbox_operator_token()?;
    let mut request = state
        .media_fetch_client
        .post(agency_runtime_endpoint(
            app,
            "/api/auth/interaction-session",
        )?)
        .timeout(VOXELBOX_REQUEST_TIMEOUT)
        .json(&serde_json::json!({
            "actor_kind": "host",
            "client_id": "buzz-alpha",
            "space": space,
            "project_ref": project_ref,
            "allowed_actions": allowed_actions,
            "ttl_seconds": 300,
        }));
    if let Some(token) = operator_token.as_deref() {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Voxelbox session failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Voxelbox session", response).await);
    }
    response
        .json::<InteractionSession>()
        .await
        .map_err(|error| format!("Voxelbox session response was invalid: {error}"))
}

async fn capture_task(
    app: &AppHandle,
    state: &AppState,
    session_token: &str,
    request: &CaptureVoxelboxTaskRequest,
) -> Result<CapturedVoxelboxTask, String> {
    let response = state
        .media_fetch_client
        .post(agency_runtime_endpoint(app, "/api/tasks")?)
        .timeout(VOXELBOX_REQUEST_TIMEOUT)
        .bearer_auth(session_token)
        .json(&serde_json::json!({
            "title": &request.title,
            "description": &request.description,
            "status": "backlog",
            "priority": "medium",
            "org_name": &request.space,
            "project_ref": &request.project_ref,
            "source_ref": &request.source_ref,
        }))
        .send()
        .await
        .map_err(|error| format!("Voxelbox task capture failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Voxelbox task capture", response).await);
    }
    response
        .json::<CapturedVoxelboxTask>()
        .await
        .map_err(|error| format!("Voxelbox task response was invalid: {error}"))
}

fn normalize_capture_request(
    mut request: CaptureVoxelboxTaskRequest,
) -> Result<CaptureVoxelboxTaskRequest, String> {
    request.space = request.space.trim().to_string();
    request.title = request.title.trim().to_string();
    request.description = request.description.trim().to_string();
    request.project_ref = request.project_ref.trim().to_string();
    request.source_ref = request.source_ref.trim().to_string();

    if request.space.is_empty() || request.space.len() > 128 {
        return Err("a valid Voxelbox Space is required".to_string());
    }
    if request.title.is_empty() || request.title.chars().count() > 200 {
        return Err("task title must be between 1 and 200 characters".to_string());
    }
    if request.description.chars().count() > 16_000 {
        return Err("task description is too long".to_string());
    }
    if !request.source_ref.starts_with("buzz://message?") || request.source_ref.len() > 2_048 {
        return Err("task source must be a Buzz message link".to_string());
    }
    Ok(request)
}

fn normalize_start_request(
    mut request: StartVoxelboxWorkRequest,
) -> Result<StartVoxelboxWorkRequest, String> {
    let capture = normalize_capture_request(CaptureVoxelboxTaskRequest {
        space: request.space,
        title: request.title,
        description: request.description,
        project_ref: request.project_ref,
        source_ref: request.source_ref,
    })?;
    request.space = capture.space;
    request.title = capture.title;
    request.description = capture.description;
    request.project_ref = capture.project_ref;
    request.source_ref = capture.source_ref;
    request.thread_ref = request.thread_ref.trim().to_string();
    request.idempotency_key = request.idempotency_key.trim().to_string();
    request.participant_id = request.participant_id.trim().to_string();
    request.mode = request.mode.trim().to_string();
    if !request.thread_ref.starts_with("buzz://message?") {
        return Err("work thread must be a Buzz message link".to_string());
    }
    if request.idempotency_key.is_empty() || request.idempotency_key.len() > 2_048 {
        return Err("a valid work idempotency key is required".to_string());
    }
    if request.participant_id.is_empty() || request.participant_id.len() > 256 {
        return Err("the current Buzz participant is required".to_string());
    }
    if request.mode != "execute" && request.mode != "plan" {
        return Err("work mode must be execute or plan".to_string());
    }
    Ok(request)
}

fn default_work_mode() -> String {
    "execute".to_string()
}

fn voxelbox_root() -> PathBuf {
    if let Ok(root) = std::env::var("VOXELBOX_HOME") {
        let root = root.trim();
        if !root.is_empty() {
            return PathBuf::from(root);
        }
    }
    dirs::home_dir().unwrap_or_default().join(".voxelbox")
}

fn read_voxelbox_operator_token() -> Result<Option<String>, String> {
    let path = voxelbox_root()
        .join("config")
        .join("auth")
        .join("cli.token");
    let data = match std::fs::read_to_string(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("could not read the local Voxelbox credential".to_string()),
    };
    let token = data.trim();
    if token.is_empty() {
        return Ok(None);
    }
    if token.len() > 4_096 {
        return Err("the local Voxelbox credential is invalid".to_string());
    }
    Ok(Some(token.to_string()))
}

async fn response_error(label: &str, response: reqwest::Response) -> String {
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    let detail = bounded_detail(&detail, 512);
    if detail.is_empty() {
        format!("{label} returned HTTP {status}")
    } else {
        format!("{label} returned HTTP {status}: {detail}")
    }
}

fn bounded_detail(detail: &str, max_chars: usize) -> String {
    let detail = detail.trim();
    let mut chars = detail.chars();
    let bounded: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{bounded}…")
    } else {
        bounded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_request_requires_a_buzz_source_and_bounded_title() {
        let valid = CaptureVoxelboxTaskRequest {
            space: " voxelbox-ai ".to_string(),
            title: " Follow up ".to_string(),
            description: " Context ".to_string(),
            project_ref: String::new(),
            source_ref: "buzz://message?channel=one&id=event".to_string(),
        };
        let normalized = normalize_capture_request(valid).expect("valid request");
        assert_eq!(normalized.space, "voxelbox-ai");
        assert_eq!(normalized.title, "Follow up");

        let invalid = CaptureVoxelboxTaskRequest {
            space: "voxelbox-ai".to_string(),
            title: "Follow up".to_string(),
            description: String::new(),
            project_ref: String::new(),
            source_ref: "https://example.com".to_string(),
        };
        assert!(normalize_capture_request(invalid).is_err());
    }

    #[test]
    fn start_request_requires_an_explicit_buzz_thread() {
        let valid = StartVoxelboxWorkRequest {
            space: "voxelbox-ai".to_string(),
            title: "Start here".to_string(),
            description: String::new(),
            project_ref: String::new(),
            source_ref: "buzz://message?channel=one&id=source".to_string(),
            thread_ref: "buzz://message?channel=one&id=thread".to_string(),
            idempotency_key: "buzz-work:source:self".to_string(),
            participant_id: "user-pubkey".to_string(),
            mode: "execute".to_string(),
        };
        assert!(normalize_start_request(valid).is_ok());
    }

    #[test]
    fn daemon_error_detail_is_trimmed_and_bounded() {
        assert_eq!(bounded_detail("  unavailable  ", 32), "unavailable");
        assert_eq!(bounded_detail("abcdef", 3), "abc…");
    }
}
