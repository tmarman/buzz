/// Service name for the desktop OS keyring. Debug builds default to a distinct
/// service, while standalone worktree launches may request a scoped dev service.
fn dev_keyring_service(configured: Option<String>) -> String {
    configured
        .filter(|service| service.starts_with("buzz-desktop-dev."))
        .unwrap_or_else(|| "buzz-desktop-dev".to_string())
}

static KEYRING_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn keyring_service_name(is_debug: bool, configured: Option<String>, identifier: &str) -> String {
    if is_debug {
        dev_keyring_service(configured)
    } else if identifier == "com.voxelbox.Buzz" {
        "buzz-desktop-alpha".to_string()
    } else {
        "buzz-desktop".to_string()
    }
}

pub(crate) fn init_keyring_service(identifier: &str) {
    let _ = KEYRING_SERVICE.set(keyring_service_name(
        cfg!(debug_assertions),
        std::env::var("BUZZ_DEV_KEYRING_SERVICE").ok(),
        identifier,
    ));
}

pub(crate) fn keyring_service() -> &'static str {
    KEYRING_SERVICE
        .get_or_init(|| keyring_service_name(cfg!(debug_assertions), None, "xyz.block.buzz.app"))
        .as_str()
}

pub(super) fn migration_marker_name(service: &str, default_name: &str) -> String {
    if service == "buzz-desktop" || service == "buzz-desktop-dev" {
        default_name.to_string()
    } else {
        format!("identity.{service}.migrated")
    }
}

#[cfg(test)]
mod tests {
    use super::{dev_keyring_service, keyring_service_name, migration_marker_name};

    #[test]
    fn standalone_scope_must_remain_under_dev_service() {
        assert_eq!(
            dev_keyring_service(Some("buzz-desktop-dev.example".to_string())),
            "buzz-desktop-dev.example"
        );
        assert_eq!(
            dev_keyring_service(Some("buzz-desktop".to_string())),
            "buzz-desktop-dev"
        );
    }

    #[test]
    fn alpha_release_uses_an_isolated_service() {
        assert_eq!(
            keyring_service_name(false, Some("buzz-desktop".to_string()), "com.voxelbox.Buzz"),
            "buzz-desktop-alpha"
        );
        assert_eq!(
            keyring_service_name(false, None, "xyz.block.buzz.app"),
            "buzz-desktop"
        );
        assert_eq!(
            keyring_service_name(true, None, "com.voxelbox.Buzz"),
            "buzz-desktop-dev"
        );
    }

    #[test]
    fn standalone_scope_uses_its_own_migration_marker() {
        assert_eq!(
            migration_marker_name("buzz-desktop", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dev", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dev.example", "identity.migrated"),
            "identity.buzz-desktop-dev.example.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-alpha", "identity.migrated"),
            "identity.buzz-desktop-alpha.migrated"
        );
    }
}
