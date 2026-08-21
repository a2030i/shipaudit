# Security foundation deployment contract

This security foundation is released in two deliberately separate phases. No
secret values belong in Git.

## Phase A — released without provider changes

- Database authorization and RLS hardening.
- Dedicated Hatif contact/workspace permissions.
- Retirement of the public Lamha diagnostic proxy.
- Hudhud address lookup fails closed when request metering is unavailable.

These changes do not require external providers to rotate credentials.

## Required secret names

| Secret | Consumer | Requirement |
|---|---|---|
| `WEBHOOK_SHARED_SECRET` | `webhook-intake` | Required; sent as `X-Webhook-Secret` by the carrier-email forwarder. |
| `ZOHO_WEBHOOK_SECRET` | `zoho-webhook` | Required; provision the same value in the Zoho webhook URL/header. |
| `HATIF_WEBHOOK_SECRET` | Hatif/Voxa callback functions | Required; Voxa signs the exact raw request body with HMAC-SHA256. |
| `IVR_WEBHOOK_SECRET` | `ivr-webhook`, `ivr-runner`, `hatif-ivr` | Required; private callback credential used only for IVR results. |

The old `zoho_auth.webhook_key` is not an allowed fallback for any of these
providers. Rotate it after the provider-specific credentials are provisioned.

## Phase B — pending coordinated provider release

1. Provision all four secret names in the target environment.
2. Configure the external carrier forwarder, Zoho, and Hatif/Voxa with their
   matching credentials/signing secret.
3. Deploy the secret-dependent webhook functions and the idempotent IVR runner
   together.
4. Push the Auth configuration with public signup disabled, then read it back.
5. Run negative authorization and callback-redelivery tests before enabling
   traffic.

If any provider cannot be provisioned, keep the current provider functions in
place and complete provisioning first. Phase A remains valid and does not rely
on Phase B secrets.
