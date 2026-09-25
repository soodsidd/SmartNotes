# Smart Notes Cloudflare email ingress

This directory is the secret-free, version-controlled deployment source for the
`smart-notes-email-inbound` Email Worker. Cloudflare Email Routing sends raw MIME
for `notes@lucidrss.com` to this Worker; the Worker posts it online to
`https://notes-inbound.lucidrss.com/api/email/inbound` and rejects delivery on
every network error or non-2xx response. It has no queue, polling, mailbox, or
retry storage.

The setup is isolated from Resume Repo: `jobs@lucidrss.com` continues to target
`resume-repo-email-inbound`, and `inbound.lucidrss.com` continues to target
`localhost:5111`.

## Runtime and secrets

Smart Notes must run on `localhost:3002` with these server-only values in its
ignored `.env.local`:

```dotenv
SMART_NOTES_EMAIL_INBOUND_TOKEN=<same-long-random-token-as-the-worker>
SMART_NOTES_EMAIL_ALLOWED_SENDERS=first.sender@example.com,second.sender@example.com
```

Do not prefix either name with `NEXT_PUBLIC_`; neither value may enter the
browser bundle. Sender matching is an exact, case-insensitive mailbox match
against Cloudflare's SMTP envelope sender. The Worker copies `message.from` to
`X-Smart-Notes-Envelope-From` on the same bearer-authenticated request as the
raw MIME. Smart Notes rejects a missing or disallowed envelope sender and also
rejects any MIME `From` that does not exactly match it. Do not accept this
header on a request that has not first passed bearer validation.

The Worker has two encrypted secrets:

| Secret | Value contract |
|---|---|
| `INBOUND_URL` | `https://notes-inbound.lucidrss.com` (no path or trailing slash) |
| `SMART_NOTES_EMAIL_INBOUND_TOKEN` | Exact token from Smart Notes `.env.local` |

Deploy or refresh the versioned Worker without printing secret values:

```powershell
Set-Location infra/cloudflare/email-inbound-worker
npx wrangler deploy
npx wrangler secret put INBOUND_URL
npx wrangler secret put SMART_NOTES_EMAIL_INBOUND_TOKEN
```

Restart Smart Notes after changing `.env.local`; environment variables are read
only by the server process.

## Tunnel path isolation

The existing `gateway` tunnel config at `%USERPROFILE%\.cloudflared\config.yml`
must keep these rules in order before its terminal catch-all. The second Smart
Notes rule prevents any other application path from reaching port 3002.

```yaml
ingress:
  - hostname: notes-inbound.lucidrss.com
    path: ^/api/email/inbound$
    service: http://localhost:3002
  # SN-166 public ingest ingress shares this hostname and origin.
  - hostname: notes-inbound.lucidrss.com
    path: ^/api/ingest$
    service: http://localhost:3002
  - hostname: notes-inbound.lucidrss.com
    service: http_status:404
  - hostname: inbound.lucidrss.com
    service: http://localhost:5111
  # existing lucidrss.com rules and final catch-all remain unchanged
```

Validate before restarting the managed connector:

```powershell
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://notes-inbound.lucidrss.com/api/email/inbound
cloudflared tunnel ingress rule https://notes-inbound.lucidrss.com/
cloudflared tunnel ingress rule https://inbound.lucidrss.com/api/email/inbound
```

Start or restart the connector through the Ascent Vector managed Runtime UI or
sidecar, not as an untracked shell process.

## Safe verification and enable gate

The Cloudflare rule `Smart Notes email ingress (SN-215)` has address
`notes@lucidrss.com`, Worker `smart-notes-email-inbound`, and rule id
`aa2ce63a84714c6abcd4614524cf77d0`. Keep it disabled through all local and direct
HTTP checks.

1. Confirm `GET https://notes-inbound.lucidrss.com/` returns tunnel-level `404`.
2. Confirm an unauthenticated `POST /api/email/inbound` returns `401`.
3. Run `npm test` in this Worker directory, the targeted application tests,
   and direct authorized MIME probes. Direct probes must include the
   `X-Smart-Notes-Envelope-From` header and prove that an allowed MIME `From`
   paired with a disallowed or absent envelope sender returns `403`.
4. Confirm `jobs@lucidrss.com -> resume-repo-email-inbound` is still enabled.
5. Only then enable the Smart Notes rule for final routed-email tests: one exact
   notebook route, one unresolved-prefix fallback, replay, disallowed sender,
   and endpoint-unavailable rejection.

Application diagnostics are emitted as structured `[email-inbound]` lines. Read
the registered runtime source with:

```powershell
node "C:\Projects\Ascent Vector\scripts\av.mjs" diag sources show --project=smart-notes --id=smart-notes-email-inbound --json
node "C:\Projects\Ascent Vector\scripts\av.mjs" diag list --project=smart-notes --work-item=SN-212 --json
npx wrangler tail smart-notes-email-inbound
```

Logs include routing prefixes and page paths but never message bodies, attachment
payloads, allowed-sender configuration, or bearer tokens.

## Rollback

1. Disable only `Smart Notes email ingress (SN-215)` using rule id
   `aa2ce63a84714c6abcd4614524cf77d0`. This immediately stops new Smart Notes
   deliveries without touching `jobs@lucidrss.com`.
2. Confirm `jobs@lucidrss.com -> resume-repo-email-inbound` remains enabled.
3. Leave the path-scoped tunnel rules in place (they are inert without email
   delivery), or restore the SN-215 backup
   `%USERPROFILE%\.cloudflared\config.yml.sn-215-backup-20260811-0617` and restart
   the managed connector if tunnel rollback is required.
4. Roll the Worker back with Wrangler deployment history if necessary. Do not
   delete or rotate shared Resume Repo resources.
5. If an application rollback removes the endpoint, keep the Smart Notes Email
   Routing rule disabled first so online-only delivery fails closed.
