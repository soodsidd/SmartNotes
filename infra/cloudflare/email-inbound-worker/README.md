# Smart Notes Cloudflare email ingress

This directory is the secret-free, version-controlled deployment source for the
`smart-notes-email-inbound` Email Worker. Cloudflare Email Routing sends raw MIME
for `notes@lucidrss.com` and `jobs@lucidrss.com` to this Worker; the Worker posts
it online to `https://notes-inbound.lucidrss.com/api/email/inbound` and rejects
delivery on every network error or non-2xx response. It has no queue, polling,
mailbox, or retry storage.

- `notes@lucidrss.com` — ordinary notebook capture; subjects starting `[Job]` or
  `Job:` also land in the Career Job Inbox.
- `jobs@lucidrss.com` — every accepted message lands in the Career Job Inbox
  (envelope recipient is authoritative even when MIME `To` still shows a
  forwarded original address).

Resume Repo's `resume-repo-email-inbound` Worker and `inbound.lucidrss.com` →
`localhost:5111` tunnel rule are retired for live job mail; leave them in place
only as rollback artifacts until the owner deletes them.

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
`X-Smart-Notes-Envelope-From` and `message.to` to `X-Smart-Notes-Envelope-To`
on the same bearer-authenticated request as the raw MIME. Smart Notes rejects a
missing or disallowed envelope sender and also rejects any MIME `From` that does
not exactly match it. Do not accept these headers on a request that has not first
passed bearer validation.

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

## Cloudflare Email Routing

| Address | Worker | Notes |
|---|---|---|
| `notes@lucidrss.com` | `smart-notes-email-inbound` | Rule id `aa2ce63a84714c6abcd4614524cf77d0` (SN-215) |
| `jobs@lucidrss.com` | `smart-notes-email-inbound` | Rewired from `resume-repo-email-inbound` for Career Job Inbox |

Update or create the `jobs@` rule in the Cloudflare Dashboard (**Email** →
**Email Routing** → **Routing rules**) or via the Email Routing Rules API with
an account that has `email_routing:write`.

## Safe verification and enable gate

Keep new routing changes disabled until local and direct HTTP checks pass.

1. Confirm `GET https://notes-inbound.lucidrss.com/` returns tunnel-level `404`.
2. Confirm an unauthenticated `POST /api/email/inbound` returns `401`.
3. Run `npm test` in this Worker directory, the targeted application tests,
   and direct authorized MIME probes. Direct probes must include the
   `X-Smart-Notes-Envelope-From` header and prove that an allowed MIME `From`
   paired with a disallowed or absent envelope sender returns `403`. Probes for
   Job Inbox should also set `X-Smart-Notes-Envelope-To: jobs@lucidrss.com`.
4. Confirm `jobs@lucidrss.com -> smart-notes-email-inbound` is enabled and the
   old Resume Repo target is disabled or removed.
5. Send one live job forward to `jobs@lucidrss.com` and confirm a Career Job
   Inbox record; send one ordinary `notes@` capture to confirm page capture is
   unchanged.

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

1. Disable or retarget only the `jobs@lucidrss.com` Email Routing rule back to
   `resume-repo-email-inbound` if Resume Repo must temporarily receive job mail
   again. Leave the `notes@` Smart Notes rule alone unless a broader rollback is
   required.
2. To stop all Smart Notes deliveries, disable `Smart Notes email ingress
   (SN-215)` using rule id `aa2ce63a84714c6abcd4614524cf77d0`.
3. Leave the path-scoped tunnel rules in place (they are inert without email
   delivery), or restore the SN-215 backup
   `%USERPROFILE%\.cloudflared\config.yml.sn-215-backup-20260811-0617` and restart
   the managed connector if tunnel rollback is required.
4. Roll the Worker back with Wrangler deployment history if necessary.
5. If an application rollback removes the endpoint, keep the Smart Notes Email
   Routing rules disabled first so online-only delivery fails closed.
