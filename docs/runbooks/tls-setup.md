# TLS / HTTPS Setup

BrandBlitz enforces HTTPS in production. The nginx reverse proxy terminates TLS and forwards plain HTTP to the internal services.

## Expected nginx prod config

The file `nginx/templates/nginx.prod.conf.template` is the canonical production nginx config. The official nginx image renders it at container startup and it:

1. Redirects all port 80 traffic to HTTPS (301)
2. Terminates TLS with the certificate at `/etc/nginx/certs/fullchain.pem`
3. Sets `Strict-Transport-Security` (max-age 31536000, includeSubDomains, preload)
4. Proxies `/api/` to the API container and everything else to the Next.js container

## Certificate

Place your TLS certificate and key at:

- `/etc/nginx/certs/fullchain.pem`
- `/etc/nginx/certs/privkey.pem`

## Verification

Check that all cookies have `Secure`, `HttpOnly`, and `SameSite=Lax` set:

```bash
curl -sI https://brandblitz.app | grep -i set-cookie
```

The API also rejects plain HTTP requests at the application level in production via the `requireHttps` middleware (checks `x-forwarded-proto` header).

When changing TLS or proxy settings, edit the template only. Do not recreate or edit a generated `nginx/nginx.prod.conf` file; production mounts the template through `docker-compose.prod.yml`.
