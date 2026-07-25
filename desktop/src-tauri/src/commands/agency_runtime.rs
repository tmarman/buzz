use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const DEFAULT_AGENCY_RUNTIME_BASE_URL: &str = "http://localhost:1337";
const AGENCY_RUNTIME_CONFIG_FILE: &str = "agency-runtime.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgencyRuntimeConfig {
    pub base_url: String,
}

impl Default for AgencyRuntimeConfig {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_AGENCY_RUNTIME_BASE_URL.to_string(),
        }
    }
}

#[tauri::command]
pub fn get_agency_runtime_config(app: AppHandle) -> Result<AgencyRuntimeConfig, String> {
    load_agency_runtime_config(&app)
}

#[tauri::command]
pub fn set_agency_runtime_config(
    app: AppHandle,
    config: AgencyRuntimeConfig,
) -> Result<AgencyRuntimeConfig, String> {
    let config = normalize_config(config)?;
    let path = agency_runtime_config_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Agency runtime config path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("could not create the Buzz config directory: {error}"))?;
    let payload = serde_json::to_vec_pretty(&config)
        .map_err(|error| format!("could not serialize the Agency runtime config: {error}"))?;
    crate::managed_agents::storage::atomic_write_json(&path, &payload)?;
    Ok(config)
}

pub fn agency_runtime_endpoint(app: &AppHandle, path: &str) -> Result<String, String> {
    let config = load_agency_runtime_config(app)?;
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    Ok(format!("{}{}", config.base_url, path))
}

fn load_agency_runtime_config(app: &AppHandle) -> Result<AgencyRuntimeConfig, String> {
    let path = agency_runtime_config_path(app)?;
    let payload = match std::fs::read(&path) {
        Ok(payload) => payload,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AgencyRuntimeConfig::default());
        }
        Err(error) => {
            return Err(format!(
                "could not read the Agency runtime config at {}: {error}",
                path.display()
            ));
        }
    };
    if payload.len() > 16_384 {
        return Err("Agency runtime config is too large".to_string());
    }
    let config = serde_json::from_slice::<AgencyRuntimeConfig>(&payload)
        .map_err(|error| format!("Agency runtime config is invalid: {error}"))?;
    normalize_config(config)
}

fn agency_runtime_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(AGENCY_RUNTIME_CONFIG_FILE))
        .map_err(|error| format!("could not resolve the Buzz config directory: {error}"))
}

fn normalize_config(mut config: AgencyRuntimeConfig) -> Result<AgencyRuntimeConfig, String> {
    config.base_url = normalize_local_runtime_url(&config.base_url)?;
    Ok(config)
}

fn normalize_local_runtime_url(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(value)
        .map_err(|_| "Agency runtime endpoint must be a valid URL".to_string())?;
    if url.scheme() != "http" {
        return Err(
            "This build supports local Agency runtimes over http; remote runtimes require an enrollment credential"
                .to_string(),
        );
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(
            "Agency runtime endpoint must contain only a local origin and optional port"
                .to_string(),
        );
    }
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    if host != "localhost" && host != "127.0.0.1" && host != "::1" {
        return Err("This credential may only be sent to a loopback Agency runtime".to_string());
    }
    Ok(url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_runtime_url_accepts_loopback_ports() {
        assert_eq!(
            normalize_local_runtime_url(" http://127.0.0.1:1444/ ").unwrap(),
            "http://127.0.0.1:1444"
        );
        assert_eq!(
            normalize_local_runtime_url("http://[::1]:1337").unwrap(),
            "http://[::1]:1337"
        );
    }

    #[test]
    fn local_runtime_url_rejects_remote_or_credentialed_targets() {
        assert!(normalize_local_runtime_url("https://agency.example").is_err());
        assert!(normalize_local_runtime_url("http://192.168.1.10:1337").is_err());
        assert!(normalize_local_runtime_url("http://user:secret@localhost:1337").is_err());
        assert!(normalize_local_runtime_url("http://localhost:1337/api").is_err());
    }
}
