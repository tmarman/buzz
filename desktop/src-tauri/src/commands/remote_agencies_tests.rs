use super::*;

#[test]
fn rejects_non_https_and_private_hosts() {
    assert!(validate_remote_agency_url("http://example.com/agency").is_err());
    assert!(validate_remote_agency_url("https://127.0.0.1/agency").is_err());
    assert!(validate_remote_agency_url("https://10.0.0.2/agency").is_err());
    assert!(validate_remote_agency_url("http://localhost:1337/surfaces").is_ok());
}

#[test]
fn rejects_private_dns_results_before_request() {
    assert!(is_private_address("192.168.1.10".parse().unwrap()));
    assert!(is_private_address("fd00::1".parse().unwrap()));
    assert!(is_private_address("fe80::1".parse().unwrap()));
    assert!(!is_private_address("203.0.113.10".parse().unwrap()));
}

#[test]
fn rejects_ipv4_embedded_ipv6_addresses() {
    for address in [
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "::ffff:10.0.0.1",
        "64:ff9b::7f00:1",
        "2002:7f00:1::",
        "2001::1",
        "ff02::1",
    ] {
        assert!(
            is_private_address(address.parse().unwrap()),
            "{address} must be rejected"
        );
    }
}

#[test]
fn validates_ipv6_literal_urls_with_normalized_hosts() {
    assert!(validate_remote_agency_url("https://[fd00::1]/agency").is_err());
    assert!(validate_remote_agency_url("https://[::1]/agency").is_err());
    assert!(validate_remote_agency_url("http://[::1]:1337/agency").is_ok());
}

#[test]
fn migrates_only_equivalent_loopback_agency_sources() {
    assert!(equivalent_loopback_agency_source(
        "http://localhost:1337/.well-known/agency.json",
        "http://127.0.0.1:1337/.well-known/agency.json"
    ));
    assert!(equivalent_loopback_agency_source(
        "http://[::1]:1337/.well-known/agency.json",
        "http://127.0.0.1:1337/.well-known/agency.json"
    ));
    assert!(!equivalent_loopback_agency_source(
        "http://localhost:1338/.well-known/agency.json",
        "http://127.0.0.1:1337/.well-known/agency.json"
    ));
    assert!(!equivalent_loopback_agency_source(
        "https://agency.example/.well-known/agency.json",
        "https://other.example/.well-known/agency.json"
    ));
}

#[test]
fn bearer_token_keys_are_endpoint_scoped_and_canonical() {
    let first = remote_agency_bearer_token_key(
        "https://example.com/agents/a.json",
        "https://example.com:443/a2a/a",
    )
    .unwrap();
    let equivalent = remote_agency_bearer_token_key(
        "https://example.com/agents/a.json",
        "https://example.com/a2a/a",
    )
    .unwrap();
    let second = remote_agency_bearer_token_key(
        "https://example.com/agents/a.json",
        "https://example.com/a2a/b",
    )
    .unwrap();
    assert_eq!(first, equivalent);
    assert_ne!(first, second);
    assert!(first.starts_with("remote-agency-a2a:"));
}

#[test]
fn bearer_token_lookup_preserves_only_synchronized_loopback_aliases() {
    let localhost = remote_agency_bearer_token_keys(
        "http://localhost:1337/api/agency/oasf/records/a",
        "http://localhost:1337/a2a/a",
    )
    .unwrap();
    let ipv4 = remote_agency_bearer_token_keys(
        "http://127.0.0.1:1337/api/agency/oasf/records/a",
        "http://127.0.0.1:1337/a2a/a",
    )
    .unwrap();
    assert_eq!(
        localhost.into_iter().collect::<BTreeSet<_>>(),
        ipv4.into_iter().collect::<BTreeSet<_>>()
    );

    let public = remote_agency_bearer_token_keys(
        "https://agency.example/agents/a",
        "https://agency.example/a2a/a",
    )
    .unwrap();
    assert_eq!(public.len(), 1);
    assert_ne!(
        public[0],
        remote_agency_bearer_token_key(
            "https://other.example/agents/a",
            "https://other.example/a2a/a"
        )
        .unwrap()
    );
}

#[test]
fn legacy_proxy_bindings_default_new_provenance_fields() {
    let proxy: RemoteAgencyProxy = serde_json::from_value(serde_json::json!({
        "agentId": "example-agent",
        "pubkey": "0".repeat(64),
        "channelId": "channel-1",
        "spaceId": "space-1",
        "recordUrl": "https://agency.example/agents/example-agent.json",
        "recordRevision": "r1"
    }))
    .expect("legacy proxy remains readable");
    assert_eq!(proxy.record_cid, None);
    assert_eq!(proxy.record_verification, None);
}

fn binding(
    community_id: &str,
    agency_id: &str,
    channel_id: &str,
    space_id: &str,
) -> RemoteAgencyBinding {
    RemoteAgencyBinding {
        community_id: community_id.to_string(),
        community_relay_url: "WSS://Relay.Example:443/".to_string(),
        source_url: format!("https://{agency_id}/.well-known/agency.json"),
        agency_id: agency_id.to_string(),
        agency_name: "Example Agency".to_string(),
        agent_ids: vec!["stale-input-is-derived".to_string()],
        space_ids: Vec::new(),
        channel_ids: Vec::new(),
        space_bindings: Vec::new(),
        proxies: vec![RemoteAgencyProxy {
            agent_id: "agent-1".to_string(),
            pubkey: "a".repeat(64),
            channel_id: channel_id.to_string(),
            space_id: Some(space_id.to_string()),
            record_url: format!("https://{agency_id}/agents/agent-1.json"),
            record_revision: None,
            record_cid: None,
            record_verification: Some("tls-only".to_string()),
        }],
        joined_at: "2026-07-31T00:00:00Z".to_string(),
    }
}

#[test]
fn scopes_and_derives_remote_agency_bindings() {
    let normalized = normalize_remote_agency_binding(binding(
        " community-1 ",
        "agency.example",
        "channel-1",
        "space-1",
    ))
    .unwrap();
    assert_eq!(normalized.community_id, "community-1");
    assert_eq!(normalized.community_relay_url, "wss://relay.example");
    assert_eq!(normalized.agent_ids, ["agent-1"]);
    assert_eq!(normalized.channel_ids, ["channel-1"]);
    assert_eq!(normalized.space_ids, ["space-1"]);
    assert_eq!(
        normalized.space_bindings,
        [RemoteAgencySpaceBinding {
            channel_id: "channel-1".to_string(),
            space_id: "space-1".to_string(),
            space_name: "space-1".to_string(),
        }]
    );
}

#[test]
fn permits_multiple_agencies_per_community_but_one_space_authority_per_channel() {
    let first = normalize_remote_agency_binding(binding(
        "community-1",
        "one.example",
        "channel-1",
        "space-1",
    ))
    .unwrap();
    let second_channel = normalize_remote_agency_binding(binding(
        "community-1",
        "two.example",
        "channel-2",
        "space-2",
    ))
    .unwrap();
    assert!(validate_community_space_bindings(&[first.clone(), second_channel]).is_ok());

    let conflicting = normalize_remote_agency_binding(binding(
        "community-1",
        "two.example",
        "channel-1",
        "space-2",
    ))
    .unwrap();
    assert!(validate_community_space_bindings(&[first, conflicting]).is_err());
}

#[test]
fn allows_the_same_channel_id_in_different_communities() {
    let first = normalize_remote_agency_binding(binding(
        "community-1",
        "one.example",
        "channel-1",
        "space-1",
    ))
    .unwrap();
    let second = normalize_remote_agency_binding(binding(
        "community-2",
        "two.example",
        "channel-1",
        "space-2",
    ))
    .unwrap();
    assert!(validate_community_space_bindings(&[first, second]).is_ok());
}

#[test]
fn rejects_ambiguous_proxy_identity_or_space_mappings() {
    let mut duplicate_agent = binding("community-1", "one.example", "channel-1", "space-1");
    let mut conflicting = duplicate_agent.proxies[0].clone();
    conflicting.space_id = Some("space-2".to_string());
    duplicate_agent.proxies.push(conflicting);
    assert!(normalize_remote_agency_binding(duplicate_agent).is_err());

    let mut duplicate_identity = binding("community-1", "one.example", "channel-1", "space-1");
    let mut conflicting = duplicate_identity.proxies[0].clone();
    conflicting.agent_id = "agent-2".to_string();
    conflicting.channel_id = "channel-2".to_string();
    duplicate_identity.proxies.push(conflicting);
    assert!(normalize_remote_agency_binding(duplicate_identity).is_err());
}

#[test]
fn legacy_bindings_remain_readable_but_unscoped() {
    let legacy: RemoteAgencyBinding = serde_json::from_value(serde_json::json!({
        "sourceUrl": "https://agency.example/.well-known/agency.json",
        "agencyId": "agency.example",
        "agentIds": [],
        "spaceIds": [],
        "channelIds": [],
        "proxies": [],
        "joinedAt": "2026-07-31T00:00:00Z"
    }))
    .expect("legacy binding remains readable");
    assert!(legacy.community_id.is_empty());
    assert!(legacy.community_relay_url.is_empty());
    assert!(legacy.space_bindings.is_empty());
}

#[test]
fn parses_public_projection_and_drops_private_fields() {
    let json = br#"{
      "id":"agency.example",
      "name":"Example Agency",
      "prompt":"private",
      "agents":[{"id":"a1","name":"Scout","memory":"private","skills":["research"],"agent_card_url":"https://example.com/a1.json"}],
      "spaces":[{"id":"s1","name":"Research","surfaces":[{"id":"board","name":"Board","type":"remote-defined","url":"https://example.com/board"}]}],
      "protocols":["a2a"]
    }"#;
    let descriptor = parse_remote_agency_document("https://example.com/agency.json", json).unwrap();
    assert_eq!(descriptor.agents[0].id, "a1");
    assert_eq!(
        descriptor.spaces[0].surfaces[0].surface_type.as_deref(),
        Some("remote-defined")
    );
    assert!(!serde_json::to_string(&descriptor)
        .unwrap()
        .contains("private"));
}

#[test]
fn rejects_cross_origin_references() {
    let json =
        br#"{"id":"agency","agents":[{"id":"a","agent_card_url":"https://evil.example/card"}]}"#;
    let descriptor = parse_remote_agency_document("https://example.com/agency.json", json).unwrap();
    assert!(descriptor.agents[0].agent_card_url.is_none());
}

#[test]
fn parses_collection_projection_shape() {
    let json = br#"{
      "agency_id":"agency.example",
      "revision":"r1",
      "agents":[{"agent_id":"a1","name":"Scout","record":"https://example.com/agents/a1.json","a2a_endpoint":"https://example.com/a2a/scout"}],
      "spaces":[{"space_id":"s1","name":"Research","surfaces":[]}]
    }"#;
    let descriptor = parse_remote_agency_document("https://example.com/agents.json", json).unwrap();
    assert_eq!(descriptor.agency_id, "agency.example");
    assert_eq!(
        descriptor.agents[0].record_url.as_deref(),
        Some("https://example.com/agents/a1.json")
    );
    assert_eq!(
        descriptor.agents[0].a2a_endpoint.as_deref(),
        Some("https://example.com/a2a/scout")
    );
    assert_eq!(descriptor.spaces[0].id, "s1");
}

#[test]
fn selects_only_a_declared_jsonrpc_interface() {
    let json = br#"{
      "id":"agency.example",
      "agents":[{
        "id":"a1",
        "supportedInterfaces":[
          {"url":"https://example.com/a2a/grpc","protocolBinding":"GRPC"},
          {"url":"https://example.com/a2a/jsonrpc","protocolBinding":"JSONRPC"}
        ]
      }]
    }"#;
    let descriptor = parse_remote_agency_document("https://example.com/agency.json", json).unwrap();
    assert_eq!(
        descriptor.agents[0].a2a_endpoint.as_deref(),
        Some("https://example.com/a2a/jsonrpc")
    );
}

#[test]
fn parses_export_projection_aliases_and_relative_refs() {
    let json = br#"{
      "agency_id":"agency.example",
      "revision":"r2",
      "agents":[{"agent_id":"a1","name":"scout","display_name":"Scout","oasf_record_url":"/agency/agents/a1.json","a2a_endpoint":"/a2a/scout"}],
      "spaces":[{"space_id":"s1","name":"Research","surfaces":[]}]
    }"#;
    let descriptor =
        parse_remote_agency_document("https://example.com/.well-known/agency.json", json).unwrap();
    assert_eq!(
        descriptor.agents[0].record_url.as_deref(),
        Some("https://example.com/agency/agents/a1.json")
    );
    assert_eq!(
        descriptor.agents[0].a2a_endpoint.as_deref(),
        Some("https://example.com/a2a/scout")
    );
    assert_eq!(descriptor.agents[0].name, "Scout");
}

#[test]
fn resolves_manifest_link_relations_without_cross_origin() {
    let json = br#"{
      "id":"agency.example",
      "links":[
        {"rel":"agents","href":"/agents.json"},
        {"rel":"https://agntcy.org/rel/spaces","href":"https://example.com/spaces.json"},
        {"rel":"agents","href":"https://evil.example/agents.json"}
      ]
    }"#;
    let source = Url::parse("https://example.com/.well-known/agency.json").unwrap();
    let links = linked_urls(&source, &serde_json::from_slice(json).unwrap());
    assert_eq!(links.len(), 2);
    assert_eq!(links[0].0, "agents");
    assert_eq!(links[0].1, "https://example.com/agents.json");
}

#[test]
fn previews_manifest_when_spaces_link_follows_namespaced_links() {
    let manifest: Value = serde_json::json!({
        "schema": "agency.remote/v1",
        "id": "urn:uuid:test-agency",
        "name": "Example Agency",
        "links": [
            {"rel": "agents", "href": "/api/agency/agents"},
            {"rel": "https://example.com/agency/rel/one/v1", "href": "/one"},
            {"rel": "https://example.com/agency/rel/two/v1", "href": "/two"},
            {"rel": "https://example.com/agency/rel/three/v1", "href": "/three"},
            {"rel": "https://example.com/agency/rel/four/v1", "href": "/four"},
            {"rel": "https://example.com/agency/rel/five/v1", "href": "/five"},
            {"rel": "spaces", "href": "/api/agency/spaces"}
        ]
    });
    let source = Url::parse("http://127.0.0.1:1337/.well-known/agency.json").unwrap();
    let links = linked_urls(&source, &manifest);
    assert_eq!(links.len(), 2);
    assert_eq!(links[1].0, "spaces");
    let linked = vec![
        (
            "agents".to_string(),
            serde_json::json!({"schema":"agency.agents/v1","agency_id":"urn:uuid:test-agency","revision":"r1","agents":[]}),
        ),
        (
            "spaces".to_string(),
            serde_json::json!({"schema":"agency.spaces/v1","agency_id":"urn:uuid:test-agency","revision":"r2","spaces":[{"schema":"space.summary/v1","id":"urn:uuid:space-1","agency_id":"urn:uuid:test-agency","name":"Research"}]}),
        ),
    ];
    let descriptor = parse_preview_document(source.as_str(), manifest, linked).unwrap();
    assert_eq!(descriptor.agency_id, "urn:uuid:test-agency");
    assert_eq!(descriptor.spaces.len(), 1);
    assert_eq!(descriptor.spaces[0].id, "urn:uuid:space-1");
}
