# TLS Configuration & Testing

## Overview

BrandBlitz uses Mozilla's **Intermediate** TLS configuration:

- Protocols: TLSv1.2, TLSv1.3
- `ssl_prefer_server_ciphers on` — server selects the strongest mutually-supported cipher
- Cipher suite: Mozilla Intermediate (see `nginx/templates/nginx.prod.conf.template`)
- Session tickets: disabled (forward secrecy)

## Running testssl.sh against staging

```bash
docker run --rm drwetter/testssl.sh --severity MEDIUM https://staging.brandblitz.io
```

Key items to verify:

| Check                       | Expected              |
| --------------------------- | --------------------- |
| `ssl_prefer_server_ciphers` | `on`                  |
| Protocols offered           | TLSv1.2, TLSv1.3 only |
| BEAST                       | not vulnerable        |
| POODLE (SSLv3)              | not vulnerable        |
| RC4                         | not offered           |
| Overall grade               | A or A+               |

## CI enforcement

The `gitleaks.yml` workflow includes a step that greps `nginx.prod.conf.template` for
`ssl_prefer_server_ciphers off` and fails the build if found. See `.github/workflows/gitleaks.yml`.

## References

- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/#server=nginx&config=intermediate)
- [testssl.sh docs](https://testssl.sh/)
