# Group-call event evidence

Checked 2026-09-20. No credentials or account identifiers are included here.

## Deployment verification

The standalone Worker was deployed to Cloudflare on 2026-09-20 JST. From the deployed runtime, authenticated history GET and streaming-token POST succeeded. Scheduled runs completed successfully with a persisted SSE cursor. With sending restricted to the owner's test group, a new live call produced duration 32,140 ms. Without a manual send, the scheduled Worker delivered one notification reading `通話時間：32秒`, 60.101 seconds after the end entry. Both D1 and the actual LINE history confirmed one notification; later scheduled runs and an explicit reconciliation did not send a duplicate. No notification was created for the corresponding zero-duration start. Sending was then expanded to GROUP chats, with a new activation baseline to exclude earlier calls.

Live chat-list requests accepted `limit=25` and rejected `limit=50` and `limit=100` with HTTP 400. History GET accepted `limit=100` but returned 50 records. The API client uses 25 for discovery and follows the returned history cursor.

Workerd compatibility required a wrapper around the global fetch function and `redirect: manual`; the runtime does not implement `redirect: error`. Responses outside 2xx are rejected without following their Location, so session cookies never follow a redirect. See the [Workerd implementation](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B) and [receiver issue](https://github.com/cloudflare/workerd/issues/6904).

## Event semantics

A replay of the three test calls established the latency cause: live `chat/callHistory` envelopes contain `payload.message` with type, version, serviceType, duration (end only), and result, but **no message.id**. The positive duration and payload timestamp exactly match the corresponding history entries. The earlier strict history parser therefore discarded the live signals and waited for scheduled history scans. The live delivery timestamps were 190–683 ms after the recorded call ends. The corrected receiver validates the signal without an ID, immediately reads that chat's history, and records the canonical message ID; it does not invent an ID or weaken durable duplicate suppression.

The account owner supplied access to the OA manager history through the parent task. Two observed pairs of normalized history entries had `message.type = callHistory`, `serviceType = GROUP_CALL`, `result = INFO`, and `version = UNKNOWN`. Each pair had a zero-duration entry followed by a positive-duration entry. The positive durations were 3,129 and 7,891; the respective timestamp differences were 3,119 and 7,901 milliseconds. Message IDs were decimal strings beyond JavaScript's safe integer range.

The public OA chat frontend [cms.DwkJzN5V.js](https://vos.line-scdn.net/line-oa-crm-pc/js/cms.DwkJzN5V.js), referenced by [main.NmWJZa55.js](https://vos.line-scdn.net/line-oa-crm-pc/js/main.NmWJZa55.js), provides corroborating static evidence. Offsets below are zero-based JavaScript string offsets of the downloaded original, not byte offsets or line numbers:

- Offset 184968: duration formatter divides by `1e3`, then minutes/hours; the unit is milliseconds.
- Offset 232019: the base model keeps the original payload, including timestamp and message.
- Offset 235865: the call-history model inherits without stripping message fields.
- Offset 360690: the call-history renderer reads serviceType/result/duration. INFO renders empty text; NORMAL formats duration. Consequently the observed empty phone bubbles do not imply missing raw duration.
- Offset 74251: the generated history client uses GET `/api/v3/bots/{botId}/chats/{chatId}/messages`; offsets 294960–298700 consume its `list`, `backward`, and `forward` fields.

`GROUP_CALL` is present in the observed server data even though it is absent from the inspected frontend service-type enum. INFO cannot distinguish start from end because both observed entries use it. The current parser deliberately accepts only the observed GROUP_CALL/INFO shape with positive duration. This is a conservative eligibility condition, not a complete documented protocol. Unknown shapes should be counted without exposing raw private messages, so compatibility changes can be investigated.

The caller supplies normalized `{timestamp, message}` and a validated allowlisted manager `chatId`. The parser does not unwrap arbitrary SSE payloads or infer the destination Messaging API group ID. It preserves message IDs as strings, filters timestamps earlier than the supplied cutoff, permits at most five minutes of clock skew, and bounds positive integer duration at 30 days. The 30-day duration and five-minute skew limits are implementation safeguards, not documented LINE service limits.

`startedAt` is an estimate (`timestamp - duration`) and must not be presented as an independently observed start. No start/end timestamp equality is required. Zero-duration entries are not sent. A true zero-duration ended call cannot be distinguished by the current classifier.

Before claiming detection of the end of an entire multi-person call, perform a live test with three participants: join, leave one participant while two remain, then end the remaining call. Check whether partial departure also produces positive-duration GROUP_CALL entries. The existing samples alone do not establish that behavior.

Durable duplicate suppression, bootstrap baselines, send leases, and ambiguous timeout handling belong to the caller. Use a unique key containing the OA identity, manager chat ID, and unchanged message ID. For official Messaging API Push, persist an initial UUID retry key before any network send and reuse the exact request/key within its 24-hour window, following [LINE retry guidance](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/). This guarantee must not be assumed for the private OA manager sending endpoint or its frontend `sendId` field.
