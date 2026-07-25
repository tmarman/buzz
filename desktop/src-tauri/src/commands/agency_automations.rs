use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::commands::agency_runtime_endpoint;

const AGENCY_AUTOMATION_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgencyAutomationSummary {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default, alias = "owner_agent")]
    owner_agent: String,
    #[serde(default)]
    scope: String,
    enabled: bool,
    #[serde(default)]
    triggers: Vec<String>,
    #[serde(default, alias = "run_mode")]
    run_mode: String,
    #[serde(default, alias = "can_run")]
    can_run: bool,
}

/// Discover provider-neutral automation definitions. Execution recipes remain
/// private to the Agency runtime; Buzz receives only enough metadata to render
/// the automation and its thread projection.
#[tauri::command]
pub async fn discover_agency_automations(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<AgencyAutomationSummary>, String> {
    let response = state
        .media_fetch_client
        .get(agency_runtime_endpoint(&app, "/api/agency/automations")?)
        .timeout(AGENCY_AUTOMATION_DISCOVERY_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("Agency automation discovery failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Agency automation discovery returned HTTP {}",
            response.status()
        ));
    }
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Agency automation discovery response was invalid: {error}"))?;
    let payload = payload.get("automations").cloned().unwrap_or(payload);
    serde_json::from_value::<Vec<AgencyAutomationSummary>>(payload)
        .map_err(|error| format!("Agency automation discovery response was invalid: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_protocol_snake_case_and_serializes_for_frontend() {
        let automation = serde_json::from_value::<AgencyAutomationSummary>(serde_json::json!({
            "id": "founder-briefing",
            "name": "founder-briefing",
            "owner_agent": "weaver",
            "enabled": true,
            "triggers": ["cron", "manual"],
            "run_mode": "thread",
            "can_run": true
        }))
        .expect("automation");
        assert_eq!(automation.owner_agent, "weaver");
        assert_eq!(automation.run_mode, "thread");
        assert!(automation.can_run);
        let frontend = serde_json::to_value(automation).expect("frontend JSON");
        assert_eq!(frontend["ownerAgent"], "weaver");
        assert_eq!(frontend["runMode"], "thread");
    }
}
