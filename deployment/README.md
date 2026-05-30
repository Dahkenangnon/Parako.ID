# Deployment

Sample reverse-proxy configurations and operational notes for running
Parako.ID behind nginx.

## Files

| File               | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `nginx.conf`       | Production-grade HTTPS reverse proxy on HTTP/2              |
| `nginx-http3.conf` | Optional HTTP/3 (QUIC) listener for JWKS and discovery only |

These samples are reviewed against nginx 1.27 and the HTTP server settings
shipped with the application. Adapt hostnames, certificate paths, and any
site-specific directives before use.

## TLS termination

Parako.ID binds plain HTTP on the configured port (default 9007). TLS is
expected to terminate at the reverse proxy. The application does not load
TLS material itself.

## `trust_proxy_hops`

`deployment.server.trust_proxy_hops` in the application configuration must
match the number of trusted reverse proxies in front of the Node.js process.

- One nginx layer terminating TLS: `trust_proxy_hops = 1`.
- CDN in front of nginx (e.g. Cloudflare): `trust_proxy_hops = 2`.

A value lower than the actual proxy count allows a remote client to spoof
`X-Forwarded-Proto` and bypass the HTTPS enforcement middleware.

## Keep-alive coordination

The application sets HTTP `keepAliveTimeout` to 65 seconds and the matching
`headersTimeout` to 70 seconds. The sample nginx upstream uses a
`keepalive_timeout` of 75 seconds so that the upstream pool always closes
its idle sockets _before_ Node does, preventing race conditions where
nginx would attempt to send a request on a connection Node has already
half-closed.

`proxy_read_timeout` is set to 305 seconds to give the application's
300-second request timeout a small grace window.

## Restart semantics

The default PM2 ecosystem ships with `instances: 1`. `pm2 reload` is _not_
zero-downtime in this configuration: the single worker is drained, exited,
and respawned, producing a brief window of unavailability. Deployments
with an uptime SLA running on PostgreSQL or MongoDB should set
`PM2_INSTANCES=2` (or higher) and provision sufficient memory headroom for
the `max_memory_restart` budget multiplied by the instance count.

SQLite deployments must keep `instances: 1`; the application enforces this
at startup.

## HTTP/3

`nginx-http3.conf` is included as a reference for deploying HTTP/3 on the
idempotent, read-only OIDC endpoints (`/.well-known/openid-configuration`
and `/oidc/v1/jwks`). Apply it alongside the main configuration and only
on builds of nginx that include `--with-http_v3_module`.

## S3-compatible object storage

`integrations.file_storage.provider = 's3'` routes uploads through the AWS
SDK v3 client. The same client speaks to AWS S3 and to every major
S3-compatible backend; the configuration matrix below summarises what each
provider expects.

| Provider            | `endpoint`                                      | `region`                          | `force_path_style` |
| ------------------- | ----------------------------------------------- | --------------------------------- | ------------------ |
| AWS S3              | _empty_ (the SDK derives the URL)               | `us-east-1`, `eu-west-1`, …       | `false`            |
| Cloudflare R2       | `https://<account-id>.r2.cloudflarestorage.com` | `auto`                            | `false`            |
| MinIO               | server URL, e.g. `https://minio.example.com`    | any non-empty string              | `true`             |
| Backblaze B2        | `https://s3.<region>.backblazeb2.com`           | bucket region, e.g. `us-west-004` | `false`            |
| DigitalOcean Spaces | `https://<region>.digitaloceanspaces.com`       | datacentre, e.g. `nyc3`           | `false`            |
| Wasabi              | `https://s3.<region>.wasabisys.com`             | region, e.g. `us-east-1`          | `false`            |

`access_key_id` and `secret_access_key` are the credentials issued by the
chosen provider. The Parako S3 provider rejects startup when any of
`region`, `bucket`, `access_key_id`, or `secret_access_key` is missing so a
misconfiguration surfaces immediately rather than at first upload.

## Multi-tenant subdomain routing

When a single nginx instance serves multiple Parako.ID tenants on
subdomains, any downstream cache (CDN, varnish, nginx `proxy_cache`) must
include `$host` in its cache key. Without it, an ETag-validated response
from one tenant can be served to another.
