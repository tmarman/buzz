use crate::managed_agents::ManagedAgentRecord;

pub(super) fn apply_managed_agent_name_update(
    record: &mut ManagedAgentRecord,
    name_update: Option<String>,
) -> bool {
    let Some(name_update) = name_update else {
        return false;
    };
    let trimmed = name_update.trim();
    if trimmed.is_empty() {
        return false;
    }

    let display_name_mirrors_handle = record.display_name.as_deref() == Some(record.name.as_str());
    if trimmed == record.name {
        return false;
    }

    record.name = trimmed.to_string();
    if display_name_mirrors_handle {
        record.display_name = Some(record.name.clone());
    }
    true
}
