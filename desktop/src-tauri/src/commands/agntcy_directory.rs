//! Read-only AGNTCY Agent Directory resolution for Remote Agency agents.
//!
//! This client uses a checked-in, wire-compatible subset of the released
//! v1.6.1 protobuf contract. It resolves a CID
//! with `StoreService/Pull`, or a name with `NamingService/Resolve`. A CID
//! response is sufficient for a manifest-bound record. Name verification is
//! optional provenance and never blocks a successful Resolve+Pull. Directory
//! discovery is not an identity or MAS-membership claim.

use std::{
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

use prost_types::{value::Kind, Struct, Value as ProtoValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tonic::{
    codegen::http::uri::PathAndQuery,
    metadata::MetadataValue,
    transport::{Channel, ClientTlsConfig, Endpoint},
    Request, Status,
};
use tonic_prost::ProstCodec;
use url::Url;

use super::remote_agencies::public_addresses;

mod generated {
    pub mod core {
        pub mod v1 {
            tonic::include_proto!("agntcy.dir.core.v1");
        }
    }
    pub mod naming {
        pub mod v1 {
            tonic::include_proto!("agntcy.dir.naming.v1");
        }
    }
    pub mod store {
        pub mod v1 {
            tonic::include_proto!("agntcy.dir.store.v1");
        }
    }
}

use generated::core::v1::{NamedRecordRef, Record, RecordRef};
use generated::naming::v1::{GetVerificationInfoRequest, ResolveRequest};
use generated::naming::v1::{GetVerificationInfoResponse, ResolveResponse};

const MAX_REFERENCE_BYTES: usize = 512;
const MAX_RECORD_BYTES: usize = 4 * 1024 * 1024;
const DIRECTORY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgntcyDirectoryLookup {
    /// Explicit gRPC endpoint, for example `https://directory.example:443`.
    pub endpoint: String,
    /// A CID or a Directory name such as `example.com/agents/worker:v1`.
    pub reference: String,
    /// The manifest parser supplies this explicitly. The resolver does not
    /// guess whether an arbitrary string is a CID or a Directory name.
    pub reference_kind: String,
    /// Optional operator-supplied bearer token.  It is used for this request
    /// only and is never included in the persisted Remote Agency binding.
    #[serde(default)]
    pub bearer_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgntcyRecordResolution {
    /// Local app-data path consumed by `buzz-a2a-acp`. The cache is
    /// content-addressed and does not contain a Directory bearer token.
    pub record_path: String,
    pub cid: String,
    pub verification: String,
    pub verification_method: Option<String>,
    pub verification_detail: Option<String>,
    pub a2a_endpoint: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedRecord {
    data: Value,
    cid: String,
    verification: DirectoryVerification,
    a2a_endpoint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DirectoryVerification {
    CidBound,
    NameVerified { method: String },
    Unverified { reason: String },
}

fn validate_lookup(input: &AgntcyDirectoryLookup) -> Result<Url, String> {
    let endpoint = super::remote_agencies::validate_remote_agency_url(&input.endpoint)?;
    if !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || (endpoint.path() != "/" && !endpoint.path().is_empty())
    {
        return Err(
            "AGNTCY Directory endpoint must use a root URL without credentials, path, query, or fragment"
                .to_string(),
        );
    }
    let reference = input.reference.trim();
    if reference.is_empty() || reference.len() > MAX_REFERENCE_BYTES {
        return Err("AGNTCY Directory reference is empty or too long".to_string());
    }
    if reference.chars().any(char::is_control) {
        return Err("AGNTCY Directory reference contains control characters".to_string());
    }
    if !matches!(input.reference_kind.as_str(), "cid" | "name") {
        return Err("AGNTCY Directory reference kind must be cid or name".to_string());
    }
    if input.bearer_token.as_deref().is_some_and(|token| {
        token.is_empty() || token.len() > 16 * 1024 || token.chars().any(char::is_whitespace)
    }) {
        return Err("AGNTCY Directory bearer token is invalid".to_string());
    }
    Ok(endpoint)
}

async fn directory_channel(endpoint: &Url) -> Result<Channel, String> {
    let addresses = public_addresses(endpoint).await?;
    let address = addresses
        .first()
        .ok_or_else(|| "AGNTCY Directory endpoint did not resolve".to_string())?;
    let host = endpoint
        .host_str()
        .ok_or_else(|| "AGNTCY Directory endpoint must include a host".to_string())?;
    let port = endpoint.port_or_known_default().unwrap_or(443);
    let authority = match address.ip() {
        std::net::IpAddr::V4(ip) => format!("{ip}:{port}"),
        std::net::IpAddr::V6(ip) => format!("[{ip}]:{port}"),
    };
    let scheme = endpoint.scheme();
    let dial_uri = format!("{scheme}://{authority}");
    let mut builder = Endpoint::from_shared(dial_uri)
        .map_err(|error| format!("invalid AGNTCY Directory endpoint: {error}"))?
        .connect_timeout(DIRECTORY_TIMEOUT)
        .timeout(DIRECTORY_TIMEOUT);
    if scheme == "https" {
        builder = builder
            .tls_config(ClientTlsConfig::new().domain_name(host.to_string()))
            .map_err(|error| format!("invalid AGNTCY Directory TLS configuration: {error}"))?;
    }
    let origin = endpoint
        .as_str()
        .parse()
        .map_err(|error| format!("invalid AGNTCY Directory origin: {error}"))?;
    builder = builder.origin(origin);
    builder
        .connect()
        .await
        .map_err(|error| format!("AGNTCY Directory connection failed: {error}"))
}

fn authorize<T>(mut request: Request<T>, token: Option<&str>) -> Result<Request<T>, String> {
    if let Some(token) = token {
        let value = MetadataValue::try_from(format!("Bearer {token}"))
            .map_err(|_| "AGNTCY Directory bearer token is invalid".to_string())?;
        request.metadata_mut().insert("authorization", value);
    }
    Ok(request)
}

async fn pull_record(channel: Channel, cid: String, token: Option<&str>) -> Result<Record, String> {
    let mut grpc = tonic::client::Grpc::new(channel);
    let request = authorize(Request::new(tokio_stream::iter([RecordRef { cid }])), token)?;
    let response = grpc
        .streaming(
            request,
            PathAndQuery::from_static("/agntcy.dir.store.v1.StoreService/Pull"),
            ProstCodec::<RecordRef, Record>::default(),
        )
        .await
        .map_err(|error: Status| format!("AGNTCY Directory Pull failed: {error}"))?;
    let mut stream = response.into_inner();
    stream
        .message()
        .await
        .map_err(|error| format!("AGNTCY Directory Pull failed: {error}"))?
        .ok_or_else(|| "AGNTCY Directory returned no record".to_string())
}

async fn resolve_name(
    channel: Channel,
    name: String,
    token: Option<&str>,
) -> Result<NamedRecordRef, String> {
    let mut grpc = tonic::client::Grpc::new(channel);
    let request = authorize(
        Request::new(ResolveRequest {
            name,
            version: None,
        }),
        token,
    )?;
    let response = grpc
        .unary(
            request,
            PathAndQuery::from_static("/agntcy.dir.naming.v1.NamingService/Resolve"),
            ProstCodec::<ResolveRequest, ResolveResponse>::default(),
        )
        .await
        .map_err(|error: Status| format!("AGNTCY Directory name resolution failed: {error}"))?;
    response
        .into_inner()
        .records
        .into_iter()
        .next()
        .ok_or_else(|| "AGNTCY Directory name did not resolve to a record".to_string())
}

async fn verify_record(
    channel: Channel,
    cid: String,
    name: Option<String>,
    version: Option<String>,
    token: Option<&str>,
) -> Result<DirectoryVerification, String> {
    let mut grpc = tonic::client::Grpc::new(channel);
    let request = authorize(
        Request::new(GetVerificationInfoRequest {
            cid: Some(cid),
            name,
            version,
        }),
        token,
    )?;
    let response = grpc
        .unary(
            request,
            PathAndQuery::from_static("/agntcy.dir.naming.v1.NamingService/GetVerificationInfo"),
            ProstCodec::<GetVerificationInfoRequest, GetVerificationInfoResponse>::default(),
        )
        .await
        .map_err(|error: Status| format!("AGNTCY Directory verification failed: {error}"))?
        .into_inner();
    if !response.verified {
        return Ok(DirectoryVerification::Unverified {
            reason: response
                .error_message
                .unwrap_or_else(|| "Directory did not verify record name ownership".to_string()),
        });
    }
    Ok(DirectoryVerification::NameVerified {
        method: "directory-name".to_string(),
    })
}

fn proto_value(value: ProtoValue) -> Value {
    match value.kind {
        Some(Kind::NullValue(_)) | None => Value::Null,
        Some(Kind::NumberValue(value)) => serde_json::Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        Some(Kind::StringValue(value)) => Value::String(value),
        Some(Kind::BoolValue(value)) => Value::Bool(value),
        Some(Kind::StructValue(value)) => struct_value(value),
        Some(Kind::ListValue(value)) => {
            Value::Array(value.values.into_iter().map(proto_value).collect())
        }
    }
}

fn struct_value(value: Struct) -> Value {
    Value::Object(
        value
            .fields
            .into_iter()
            .map(|(key, value)| (key, proto_value(value)))
            .collect(),
    )
}

fn canonical_json(value: &Value, output: &mut Vec<u8>) -> Result<(), String> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
        Value::Number(value) => output.extend_from_slice(value.to_string().as_bytes()),
        Value::String(value) => output.extend_from_slice(
            &serde_json::to_vec(value).map_err(|error| format!("invalid JSON string: {error}"))?,
        ),
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                canonical_json(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                output.extend_from_slice(
                    &serde_json::to_vec(key)
                        .map_err(|error| format!("invalid JSON object key: {error}"))?,
                );
                output.push(b':');
                canonical_json(values.get(key).expect("object key exists"), output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn read_varint(bytes: &[u8], offset: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..=63).step_by(7) {
        let byte = *bytes
            .get(*offset)
            .ok_or_else(|| "AGNTCY CID is truncated".to_string())?;
        *offset += 1;
        if shift == 63 && byte & 0x7e != 0 {
            return Err("AGNTCY CID varint overflows".to_string());
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("AGNTCY CID varint is too long".to_string())
}

fn write_varint(mut value: u64, output: &mut Vec<u8>) {
    while value >= 0x80 {
        output.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    output.push(value as u8);
}

fn decode_base32(value: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut accumulator = 0u32;
    let mut bits = 0u8;
    for byte in value.bytes() {
        let digit = match byte.to_ascii_lowercase() {
            b'a'..=b'z' => byte.to_ascii_lowercase() - b'a',
            b'2'..=b'7' => byte - b'2' + 26,
            _ => return Err("AGNTCY CID is not valid base32".to_string()),
        };
        accumulator = (accumulator << 5) | u32::from(digit);
        bits += 5;
        while bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
            accumulator &= (1 << bits) - 1;
        }
    }
    if bits >= 5 || (bits > 0 && accumulator != 0) {
        return Err("AGNTCY CID has invalid base32 padding".to_string());
    }
    Ok(output)
}

fn encode_base32(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut output = String::new();
    let mut accumulator = 0u32;
    let mut bits = 0u8;
    for byte in bytes {
        accumulator = (accumulator << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(ALPHABET[((accumulator >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((accumulator << (5 - bits)) & 0x1f) as usize] as char);
    }
    output
}

fn cid_for_record(value: &Value) -> Result<String, String> {
    let mut canonical = Vec::new();
    canonical_json(value, &mut canonical)?;
    let digest = Sha256::digest(canonical);
    let mut bytes = Vec::with_capacity(40);
    write_varint(1, &mut bytes); // CIDv1
    write_varint(1, &mut bytes); // AGNTCY record codec
    write_varint(0x12, &mut bytes); // multihash sha2-256
    write_varint(digest.len() as u64, &mut bytes);
    bytes.extend_from_slice(&digest);
    Ok(format!("b{}", encode_base32(&bytes)))
}

fn verify_record_cid(value: &Value, expected: &str) -> Result<(), String> {
    let expected = expected.trim();
    if !expected.starts_with('b') {
        return Err("AGNTCY Directory returned an invalid CID multibase".to_string());
    }
    let encoded = decode_base32(&expected[1..])?;
    let mut offset = 0;
    if read_varint(&encoded, &mut offset)? != 1
        || read_varint(&encoded, &mut offset)? != 1
        || read_varint(&encoded, &mut offset)? != 0x12
    {
        return Err("AGNTCY Directory CID has an unsupported version, codec, or hash".to_string());
    }
    let length = read_varint(&encoded, &mut offset)?;
    if length != 32 || encoded.len() != offset + length as usize {
        return Err("AGNTCY Directory CID has an invalid sha2-256 digest length".to_string());
    }
    let actual = cid_for_record(value)?;
    if !actual.eq_ignore_ascii_case(expected) {
        return Err("AGNTCY Directory record bytes do not match the requested CID".to_string());
    }
    Ok(())
}

fn extract_a2a_endpoint(value: &Value) -> Result<Option<String>, String> {
    let Some(modules) = value.get("modules").and_then(Value::as_array) else {
        return Ok(None);
    };
    for module in modules {
        if module.get("name").and_then(Value::as_str) != Some("integration/a2a") {
            continue;
        }
        let Some(card_data) = module.get("data").and_then(|data| data.get("card_data")) else {
            continue;
        };
        if let Some(raw) = card_data
            .get("serviceEndpoint")
            .or_else(|| card_data.get("service_endpoint"))
            .and_then(Value::as_str)
        {
            let endpoint = super::remote_agencies::validate_remote_agency_url(raw)?;
            return Ok(Some(endpoint.to_string()));
        }
        if let Some(interfaces) = card_data
            .get("supportedInterfaces")
            .or_else(|| card_data.get("supported_interfaces"))
            .and_then(Value::as_array)
        {
            for interface in interfaces {
                let binding = interface
                    .get("protocolBinding")
                    .or_else(|| interface.get("protocol_binding"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if !binding.contains("jsonrpc") {
                    continue;
                }
                if let Some(raw) = interface
                    .get("url")
                    .or_else(|| interface.get("endpoint"))
                    .and_then(Value::as_str)
                {
                    let endpoint = super::remote_agencies::validate_remote_agency_url(raw)?;
                    return Ok(Some(endpoint.to_string()));
                }
            }
        }
    }
    Ok(None)
}

fn record_to_json(record: Record) -> Result<Value, String> {
    let data = record
        .data
        .ok_or_else(|| "AGNTCY Directory record has no data".to_string())?;
    Ok(struct_value(data))
}

async fn resolve_record(
    input: &AgntcyDirectoryLookup,
    endpoint: &Url,
) -> Result<ResolvedRecord, String> {
    let channel = directory_channel(endpoint).await?;
    let reference = input.reference.trim();
    let (cid, record, verification) = if input.reference_kind == "cid" {
        let record = pull_record(
            channel.clone(),
            reference.to_string(),
            input.bearer_token.as_deref(),
        )
        .await?;
        (
            reference.to_string(),
            record,
            DirectoryVerification::CidBound,
        )
    } else {
        let resolved = resolve_name(
            channel.clone(),
            reference.to_string(),
            input.bearer_token.as_deref(),
        )
        .await?;
        let record = pull_record(
            channel.clone(),
            resolved.cid.clone(),
            input.bearer_token.as_deref(),
        )
        .await?;
        let verification = match verify_record(
            channel.clone(),
            resolved.cid.clone(),
            Some(resolved.name.clone()),
            Some(resolved.version.clone()),
            input.bearer_token.as_deref(),
        )
        .await
        {
            Ok(value) => value,
            Err(error) => DirectoryVerification::Unverified { reason: error },
        };
        (resolved.cid, record, verification)
    };
    let data = record_to_json(record)?;
    verify_record_cid(&data, &cid)?;
    let a2a_endpoint = extract_a2a_endpoint(&data)?;
    let encoded = serde_json::to_vec(&data).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_RECORD_BYTES {
        return Err("AGNTCY Directory record exceeds the 4 MiB limit".to_string());
    }
    Ok(ResolvedRecord {
        data,
        cid,
        verification,
        a2a_endpoint,
    })
}

fn record_cache_path(app: &AppHandle, cid: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("remote-agency-records");
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create remote record cache: {error}"))?;
    let digest = Sha256::digest(cid.as_bytes());
    Ok(root.join(format!("{}.json", hex::encode(digest))))
}

fn write_record_cache(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "AGNTCY Agent Record cache path has no parent".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("failed to create AGNTCY Agent Record cache: {error}"))?;
    temporary
        .write_all(bytes)
        .map_err(|error| format!("failed to write AGNTCY Agent Record cache: {error}"))?;
    temporary
        .as_file_mut()
        .sync_all()
        .map_err(|error| format!("failed to sync AGNTCY Agent Record cache: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("failed to commit AGNTCY Agent Record cache: {error}"))?;
    Ok(())
}

/// Resolve one AGNTCY OASF Agent Record without importing private runtime state.
pub async fn resolve_agntcy_agent_record(
    input: AgntcyDirectoryLookup,
    app: &AppHandle,
) -> Result<AgntcyRecordResolution, String> {
    let endpoint = validate_lookup(&input)?;
    let resolved = resolve_record(&input, &endpoint).await?;
    let bytes = serde_json::to_vec(&resolved.data)
        .map_err(|error| format!("failed to encode AGNTCY Directory record: {error}"))?;
    let path = record_cache_path(app, &resolved.cid)?;
    write_record_cache(&path, &bytes)?;
    match resolved.verification {
        DirectoryVerification::CidBound => Ok(AgntcyRecordResolution {
            record_path: path.to_string_lossy().to_string(),
            cid: resolved.cid,
            verification: "cid-bound".to_string(),
            verification_method: Some("manifest-bound-cid".to_string()),
            verification_detail: None,
            a2a_endpoint: resolved.a2a_endpoint,
        }),
        DirectoryVerification::NameVerified { method } => Ok(AgntcyRecordResolution {
            record_path: path.to_string_lossy().to_string(),
            cid: resolved.cid,
            verification: "verified".to_string(),
            verification_method: Some(method),
            verification_detail: None,
            a2a_endpoint: resolved.a2a_endpoint,
        }),
        DirectoryVerification::Unverified { reason } => Ok(AgntcyRecordResolution {
            record_path: path.to_string_lossy().to_string(),
            cid: resolved.cid,
            verification: "unverified".to_string(),
            verification_method: Some("directory-name-unverified".to_string()),
            verification_detail: Some(reason),
            a2a_endpoint: resolved.a2a_endpoint,
        }),
    }
}

#[tauri::command]
pub async fn resolve_remote_agency_record(
    input: AgntcyDirectoryLookup,
    app: AppHandle,
) -> Result<AgntcyRecordResolution, String> {
    resolve_agntcy_agent_record(input, &app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;
    use prost_types::ListValue;
    use std::collections::BTreeMap;

    #[test]
    fn validates_explicit_references() {
        let endpoint = validate_lookup(&AgntcyDirectoryLookup {
            endpoint: "https://directory.example:443".to_string(),
            reference: "example.com/agent:v1".to_string(),
            reference_kind: "name".to_string(),
            bearer_token: None,
        });
        assert!(endpoint.is_ok());
        assert!(validate_lookup(&AgntcyDirectoryLookup {
            endpoint: "https://directory.example:443".to_string(),
            reference: "\n".to_string(),
            reference_kind: "name".to_string(),
            bearer_token: None,
        })
        .is_err());
        assert!(validate_lookup(&AgntcyDirectoryLookup {
            endpoint: "https://directory.example/base".to_string(),
            reference: "baearei4example".to_string(),
            reference_kind: "cid".to_string(),
            bearer_token: None,
        })
        .is_err());
    }

    #[test]
    fn converts_struct_values_without_executing_content() {
        let mut fields = BTreeMap::new();
        fields.insert(
            "name".to_string(),
            ProtoValue {
                kind: Some(Kind::StringValue("Voxelbox".to_string())),
            },
        );
        fields.insert(
            "capabilities".to_string(),
            ProtoValue {
                kind: Some(Kind::ListValue(ListValue { values: vec![] })),
            },
        );
        assert_eq!(
            struct_value(Struct { fields }),
            serde_json::json!({"name": "Voxelbox", "capabilities": []})
        );
    }

    #[test]
    fn extracts_and_validates_a2a_endpoint_from_oasf_integration_module() {
        let record = serde_json::json!({
            "modules": [
                {
                    "name": "integration/other",
                    "data": {"url": "https://wrong.example"}
                },
                {
                    "name": "integration/a2a",
                    "data": {
                        "card_data": {
                            "provider": {"url": "https://wrong.example"},
                            "serviceEndpoint": "https://agents.example/a2a/scout"
                        }
                    }
                }
            ]
        });
        assert_eq!(
            extract_a2a_endpoint(&record)
                .expect("endpoint is valid")
                .as_deref(),
            Some("https://agents.example/a2a/scout")
        );
        assert!(extract_a2a_endpoint(&serde_json::json!({
            "modules": [{
                "name": "integration/a2a",
                "data": {"card_data": {"serviceEndpoint": "http://10.0.0.2/a2a"}}
            }]
        }))
        .is_err());
    }

    #[test]
    fn verifies_canonical_record_cid_and_rejects_changed_bytes() {
        let record = serde_json::json!({
            "name": "Scout",
            "skills": ["research"],
            "nested": {"z": 2, "a": 1}
        });
        let cid = cid_for_record(&record).expect("CID computes");
        assert!(cid.starts_with("baeare"), "unexpected AGNTCY CID: {cid}");
        verify_record_cid(&record, &cid).expect("CID matches canonical record");
        let changed = serde_json::json!({
            "name": "Scout",
            "skills": ["research", "changed"],
            "nested": {"z": 2, "a": 1}
        });
        assert!(verify_record_cid(&changed, &cid).is_err());
        assert!(verify_record_cid(&record, "bafkrei-invalid").is_err());
    }

    #[test]
    fn generated_directory_wire_messages_round_trip() {
        let original = RecordRef {
            cid: "bafybeigdyrzt4example".to_string(),
        };
        let encoded = original.encode_to_vec();
        let decoded = RecordRef::decode(encoded.as_slice()).expect("record ref decodes");
        assert_eq!(decoded.cid, original.cid);

        let request = ResolveRequest {
            name: "voxelbox/scout".to_string(),
            version: Some("v1".to_string()),
        };
        let decoded = ResolveRequest::decode(request.encode_to_vec().as_slice())
            .expect("resolve request decodes");
        assert_eq!(decoded.name, "voxelbox/scout");
        assert_eq!(decoded.version.as_deref(), Some("v1"));
    }

    #[test]
    fn record_cache_atomically_replaces_existing_content() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("record.json");

        write_record_cache(&path, br#"{"version":1}"#).expect("first cache write");
        write_record_cache(&path, br#"{"version":2}"#).expect("replacement cache write");

        assert_eq!(
            std::fs::read(&path).expect("read cached record"),
            br#"{"version":2}"#
        );
    }
}
