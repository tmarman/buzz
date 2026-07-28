# AGNTCY Directory protobuf provenance

The files under `agntcy/dir` are a reduced, wire-compatible client subset of
`github.com/agntcy/dir@v1.6.1` (Apache-2.0). They are not a vendored copy of
the full upstream schema. The upstream source paths at the pinned tag are:

- https://github.com/agntcy/dir/blob/v1.6.1/proto/agntcy/dir/core/v1/record.proto
- https://github.com/agntcy/dir/blob/v1.6.1/proto/agntcy/dir/naming/v1/naming_service.proto
- https://github.com/agntcy/dir/blob/v1.6.1/proto/agntcy/dir/store/v1/store_service.proto

The checked-in files retain only the messages and RPC declarations required
by the read-only client. They preserve the upstream package names, field
numbers, wire types, and RPC paths. They omit validation extensions and
write/search services. Reviewers must compare the reduced files against the
pinned upstream tag when the client contract changes.

Buzz uses only `StoreService/Pull`, `NamingService/Resolve`, and
`NamingService/GetVerificationInfo`. `tonic-prost-build` generates the Rust
client at build time with the vendored `protoc` binary. This is not a full
AGNTCY SDK.
