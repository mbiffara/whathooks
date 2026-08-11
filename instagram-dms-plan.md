# Instagram DMs as a paid channel (Zernio), sold per account

> **Status: design only, not started.** Filed 2026-08-11 after an exploration pass over the
> codebase and the Zernio docs. Nothing here has been built. Two assumptions must be verified
> against the live Zernio API before any of it is committed to — see "What Zernio gives us,
> and what it doesn't".

## Context

Today whathooks is single-channel: `WaSession` is the only "connected account" entity, and every
inbox, flow, agent, contact and ACL hangs off `sessionId`. The goal is to make **Instagram a peer
of WhatsApp** — IG threads in the inbox, AI agents, flows, contacts, tags, and mirror groups — with
DMs delivered through the [Zernio API](https://docs.zernio.com), and to sell it as an **add-on at
$8.99 per connected Instagram account per month** on top of any paid plan, rather than folding it
into plan limits.

**This is a large build.** Read the phasing before committing to a date: the channel abstraction
(Phase 0) is a prerequisite refactor with no user-visible output, and the cross-channel mirror
(Phase 4) is the genuinely novel part with no existing analogue.

### What makes this tractable

`Conversation` and `Message` are already channel-neutral **as columns** — a thread key, a display
name, a direction, a type. The coupling is concentrated in three places, not spread across the app:

1. `ConnectionManagerService` (`api/src/whatsapp/connection-manager.service.ts`, 2072 lines) — the
   socket map, the five Baileys handlers, and `toJid()`/`describeMessage()`/`buildBaileysMedia()`.
2. `remoteJid` treated as a *parseable JID* (`.endsWith('@g.us')`, `.split('@')[0]`) in about a
   dozen spots rather than as an opaque address.
3. The mirror subsystem, which is built on WhatsApp group primitives (`sock.groupCreate`,
   `sock.groupLeave`, `key.participant`) and keyed on `HumanAgent.phoneNumber`.

The best existing seam is already there: `FlowEngineService` imports the manager with `import type`
and receives it as a *parameter* on every entry point (`flow-engine.service.ts:14-17,107,164,226,549`).
Swap that parameter's type for an interface and the whole automation layer stops caring about the
channel.

### What Zernio actually returns (verified 2026-08-11 against the live API)

Base URL is **`https://zernio.com/api/v1`** (not `api.zernio.com`), bearer auth, one key for the
whole integration. Shapes below were captured from a real connected Instagram account, so they are
facts, not assumptions.

`GET /accounts` → `{ accounts: [...], hasAnalyticsAccess }`. Per account: `_id` (this is the
`accountId`), `platform: "instagram"`, `username`, `displayName`, `profilePicture`, `profileUrl`,
`isActive`, `enabled`, `platformStatus`, `permissions[]`, and **`profileId` is an object**
`{ _id, name }` — not the bare string the connect docs imply. DM access requires
`instagram_business_manage_messages` in `permissions`.

`GET /inbox/conversations?accountId=…` → `{ data: [...] }`. Per conversation: `id`, `accountId`,
`accountUsername`, `platform`, `participantId`, `participantName`, `participantUsername`,
`participantPicture`, `lastMessage`, `updatedTime`, `status`, `unreadCount`, `url` (deep link to the
thread), and `instagramProfile` `{ isFollower, isFollowing, followerCount, isVerified, fetchedAt }`.
Note **`id` equals `participantId`** — an Instagram DM thread is identified by the person in it.

`GET /inbox/conversations/{id}/messages?accountId=…` → `{ status, messages, pagination,
sortOrderApplied, lastUpdated }` — note the envelope key is `messages` here but `data` on
conversations; do not write one generic unwrapper. Pagination is cursor-based:
`{ hasMore, nextCursor }`. Per message: `id`, `conversationId`, `accountId`, `platform`, `message`,
`senderId`, `senderName`, **`direction: "incoming" | "outgoing"`**, `createdAt`, `sentAt`,
`attachments[]`, `isStoryMention`, `isEdited`, `editCount`, `editHistory[]`, `isDeleted`.

Attachments are `{ type: "image", url, _id, refreshUrl }`. The `refreshUrl` exists because Instagram
CDN links expire — our existing "download to S3 on ingest" path (`MediaService`) is already the
right behaviour; never persist `url` as the durable location.

**There is no webhook management API.** `GET /v1/webhooks` serves the dashboard SPA on both GET and
POST — verified against a control path, so this is absence of the route, not a method restriction.
Endpoints are registered by hand at `zernio.com/dashboard/webhooks` (max 10 per team), which
reinforces the single-shared-endpoint design below.

**Registered 2026-08-11**: webhook `6a7b264231c9a977d2a9c63d`, "whathooks (capture)", pointing at
`https://api.whathooks.app/v1/instagram/webhook`, active, subscribed to 11 events. Its signing
secret is in Secrets Manager at
`arn:aws:secretsmanager:us-east-1:817950288909:secret:whathooks/zernio-webhook-secret-2G1Cnp`.

**The event catalogue is much larger than the docs list**, and four of these matter:

| Group | Events |
|---|---|
| Accounts | `account.connected`, `account.disconnected`, `account.ads.initial_sync_completed` |
| Messages | `message.received`, `message.sent`, `message.edited`, `message.deleted`, `message.delivered`, `message.read`, `message.failed`, `reaction.received` |
| Conversations | `conversation.started` |

- **`message.failed`** is almost certainly how a closed 24-hour window surfaces — subscribe to it and
  treat it as the signal to post the "window closed" note back into the mirror group.
- **`account.disconnected`** covers the token-expiry problem without polling `tokenExpiresAt`.
- **`message.sent`** is the "typed in the Instagram app" case, the analogue of WhatsApp `fromMe`.
- **`message.delivered` / `message.read`** give the same ack tracking WhatsApp already has.

**Envelope, captured from a real signed delivery:**

```json
{ "id": "4cb2264a-aa4d-467a-9291-631d95ead593",
  "event": "webhook.test",
  "timestamp": "2026-08-11T13:40:39.010Z" }
```

`id` is a UUID and is the dedupe key; `event` is the discriminator. Note `webhook.test` is itself an
event type that is not in the subscribe list — the handler must ignore unknown `event` values rather
than treating them as messages.

**Signature:** the secret is *ours* — we supply it at registration and Zernio HMACs with it, so
there is nothing to reverse-engineer. Delivery carries **two** 64-hex-character headers,
`x-zernio-signature` and `x-late-signature`. 64 hex = 32 bytes = HMAC-SHA256, raw hex with no
`sha256=` prefix and no timestamp-prefixed scheme. Confirm which header is authoritative (and what
`x-late-signature` covers) by computing both against the raw body before enforcing.

### The real `message.received`, and the id trap it hides

Captured 2026-08-11 from an actual DM:

```json
{ "id": "2d507d40-…", "event": "message.received",
  "message": { "id": "6a7b2716…", "conversationId": "6a7a2546d0fe733d1af2cc11",
    "platformMessageId": "aWdfZAG1faXRlbTox…", "direction": "incoming",
    "text": "Hola", "attachments": [], "isRead": false, "sentAt": "…",
    "sender": { "id": "2307893396386885", "name": "Timeless",
      "username": "timelessprivateclub", "contactId": "6a7b2428…",
      "instagramProfile": { "isFollower": true, "isFollowing": true,
        "followerCount": 2367, "isVerified": false } } },
  "conversation": { "id": "6a7a2546d0fe733d1af2cc11",
    "platformConversationId": "2307893396386885", "participantId": "2307893396386885",
    "participantName": "…", "participantUsername": "…", "participantPicture": "…",
    "status": "active", "contactId": "6a7b2428…" },
  "account": { "id": "6a7a247a…", "accountId": "6a7a247a…", "username": "marcepiano",
    "profileId": "6a7a2266cbe982a78db6c45c", "platform": "instagram" },
  "timestamp": "…" }
```

**⚠️ Key Instagram conversations on `conversation.platformConversationId`, never on the webhook's
`conversationId`.** Zernio has two id spaces and the webhook leads with the wrong one. Verified
against the live API:

| id passed to `GET /inbox/conversations/{id}/messages` | source | result |
|---|---|---|
| `6a7a2546d0fe733d1af2cc11` | webhook `message.conversationId` / `conversation.id` | **HTTP 200, 0 messages** |
| `2307893396386885` | webhook `conversation.platformConversationId` (== `participantId`) | HTTP 200, **51 messages** |

The wrong id fails **silently with a 200 and an empty list**, not a 404. Storing it as `remoteJid`
would produce threads that look correct and are permanently empty, with nothing in any log to
explain why. `platformConversationId` is also what `GET /inbox/conversations` returns as its `id`,
so it is the one consistent key across both surfaces.

**Webhook and REST shapes disagree for the same entities — do not share DTOs between them:**

| | webhook | REST |
|---|---|---|
| message body | `message.text` | `message` |
| sender name | `sender.name` (nested) | `senderName` (flat) |
| conversation key | `conversationId` = internal | `id` = platform |
| `profileId` | string | object `{ _id, name }` |

Useful extras the webhook gives for free: `sender.instagramProfile` (`isFollower`, `isFollowing`,
`followerCount`, `isVerified`) — real qualification signal for a flow's AI decision node — and
`platformMessageId`, the Instagram-side id, alongside Zernio's own `message.id`.

### Sending, verified end to end

`POST /inbox/conversations/{conversationId}/messages` with body `{ accountId, message }` →
`{ "success": true, "data": { "messageId": "<platformMessageId>", "conversationId": "<internal id>" } }`
— a **third** envelope shape, after `{data:[]}` and `{status, messages, pagination}`.

Send accepts **either** id (unlike the read path, which silently returns nothing for the internal
one), but it echoes back the *internal* id. Store and send with `platformConversationId` regardless;
it is the only key that works on both surfaces.

**Attachments: `attachmentUrl` + `attachmentType`, and the second one is not optional in practice.**
The parameter name was found by probing — every unrecognised name returns the same "Message,
attachment, or interactive content is required", while a recognised one fails differently.
`attachmentType` is forwarded verbatim to Meta's `message[attachment][type]` (an invalid value comes
back as "Param message[attachment][type] is not supported"). **Omitting it defaults to `file`**, so
the message still sends 200 but a photo lands in the customer's DMs as a downloadable document and a
voice note as an unplayable attachment. Verified the hard way: the first round of test sends all
arrived as files.

Supported, all confirmed by actually delivering to a live thread: image (png, jpeg, gif — 8 MB),
video (mp4, ogg, avi, mov, webm — 25 MB), audio (aac, m4a, wav, mp4 — 25 MB), file (pdf — 25 MB).
**MP3 is rejected even with `attachmentType: "audio"`**, so it is a format rule and not a typing
mistake. Encoded with the size ceilings in `api/src/instagram/instagram-media.ts`.

**`message.sent` fires for our own API sends, not only for messages typed in the Instagram app.**
Confirmed: two API sends produced two `message.sent` deliveries, same envelope and shape as
`message.received` with `direction: "outgoing"` and `sender` being the connected account. So ingest
must dedupe or every outbound message is stored twice. The mechanism already exists for WhatsApp —
persist our send with `Message.waMessageId = data.messageId`, and drop an inbound `message.sent`
whose `platformMessageId` we have already stored. A `platformMessageId` we have *not* seen is a
message the owner typed in the Instagram app: persist it as `MessageSource.DEVICE`, exactly as
`handleOwnDevice` does for WhatsApp `key.fromMe`.

Three things the spike surfaced that the first draft of this plan missed entirely:

1. **Instagram tokens expire.** The account carries `tokenExpiresAt` (~60 days out), plus
   `needsReconnection`, `inboxAuthErrorAt` and `intentionalDisconnectAt`. Without handling, every
   connected account silently stops working roughly every two months. This needs the same treatment
   as a dropped WhatsApp socket: a scheduled expiry check, a "reconnect your Instagram account"
   email, and a `WaSession.status` flip — reuse `alertedDisconnectAt` and the `alertSession` path in
   `connection-manager.service.ts` rather than inventing a second alerting mechanism.
2. **`direction: "outgoing"` includes messages the owner sent from the Instagram app.** This is the
   same problem already solved for WhatsApp `key.fromMe` — ingest them, attribute them to
   `MessageSource.DEVICE`, and dedupe on the provider message id so our own sends don't double up.
3. **`isStoryMention`, `isEdited` and `isDeleted` are first-class.** Story mentions arrive as DMs;
   we already learned on WhatsApp that status-type content must not become inbox threads, so decide
   deliberately rather than letting them through by default.

**Still unverified, and both need a live trigger rather than a read:** the `message.received`
webhook payload (requires registering an endpoint and receiving one) and the failure shape when
Meta's **24-hour messaging window** has closed. That window remains the biggest product risk — Meta
blocks business-initiated DMs more than 24h after the customer's last message, which directly breaks
the mirror pitch (an agent replying from a WhatsApp group the next morning). Sends must be assumed
to fail for this reason and report it back into the group.

### Unit economics

Zernio bills per **account-day**, graduated: first 10 accounts $6/mo, next 90 $3/mo, beyond that
$1/mo, less a flat $12/mo credit. Against $8.99 of revenue per account:

| Connected accounts (total, all customers) | Zernio cost/mo | Revenue/mo | Margin |
|---|---|---|---|
| 10 | $48 | $90 | 47% |
| 100 | $318 | $899 | 65% |
| 500 | $718 | $4,495 | 84% |

Margin is thin at the very start and improves sharply. Both sides prorate daily, so mid-month churn
roughly cancels out.

---

## Phase 0 — Make the core channel-neutral (prerequisite, no user-visible change)

1. **Discriminator on the existing session table.** Add `enum Channel { WHATSAPP INSTAGRAM }` and
   `channel Channel @default(WHATSAPP)` to `WaSession` (`api/prisma/schema.prisma:176`). Keep the
   model name — renaming it to `Channel`/`Session` is pure churn across ~50 `prisma.waSession` call
   sites and every `sessionId` FK already means the right thing. Add nullable IG columns:
   `externalAccountId String?` (Zernio `accountId`), `externalProfileId String?`,
   `externalHandle String?` (the `@handle`, the IG analogue of `phoneNumber`).
   Reuse `WaSessionStatus`: `PENDING → CONNECTING → CONNECTED/DISCONNECTED`; `QR`, `qr`,
   `shareToken*`, `WaCredential` and `WaSignalKey` simply stay unused for IG.

2. **Addresses become opaque.** New `api/src/common/address.ts` with `isGroupAddress(session, addr)`,
   `displayHandle(conversation)`, `toChannelAddress(session, input)`. Replace the direct
   `.endsWith('@g.us')` / `.split('@')[0]` uses in `connection-manager.service.ts` (`:604,712,1723`),
   `conversations.service.ts:173,689`, `flow-engine.service.ts:677`, `mirror.service.ts:300`.
   Instagram `remoteJid` values are stored **prefixed** (`ig:<zernioConversationId>`) so any code
   that still tries to parse one as a JID fails loudly instead of silently producing garbage — this
   is what keeps the operator-redaction path in `conversations.service.ts` from leaking a raw id
   into the `contact` field.

3. **Lift persistence and automation out of the socket class.** Two extractions from
   `connection-manager.service.ts`, both already channel-neutral in substance:
   - `persistMessage` (`:1696-1810`) → `MessageStoreService` (conversation upsert on
     `sessionId_remoteJid`, message row, S3 media, avatar refresh).
   - `runAutomation` (`:827-887`) → `InboundAutomationService` (mirror relay → flow engine →
     `maybeAgentReply`), taking a `ChannelDriver` rather than the concrete manager.

4. **`ChannelDriver` interface + `ChannelRouterService`.** The driver covers only what other modules
   actually call: `isLive`, `sendText`, `sendMedia`, `resolveAddress?`, and the optional group
   primitives (`createGroup`, `leaveGroup`) that only WhatsApp implements. `ConnectionManagerService`
   becomes the WhatsApp implementation. The router dispatches on `session.channel` and is what
   `MessagesService` (`:29,38,56`), `ConversationsService` (`:164,309,325,356,546,568,640`),
   `MirrorService` (`:329`) and `FlowEngineService` inject instead of the manager.
   `WhatsappService` and the metrics/admin `getLiveSessionCount` callers keep talking to the
   concrete WhatsApp manager — QR pairing and socket counts are legitimately WA-only.
   Leader election (the `whathooks:session-leader` Redis lock, `:133-140`) stays WhatsApp-only;
   a webhook-driven channel needs no leader.

5. **Fix the `PLANS` mutation bug first** (`api/src/billing/quota.service.ts:59-75`). On the
   non-trialing branch `limits` is a *reference* to the module-level `PLANS[org.plan]`, so
   `limits.messagesPerMonth = org.messageLimitOverride` mutates the shared singleton for the whole
   process — one org's admin override currently leaks onto every other org on that tier until
   restart. Spread into a new object like the trialing branch does. This must land before any new
   per-org entitlement is read through `orgBilling`. **Worth fixing on its own merits, today,
   independent of Instagram.**

## Phase 1 — The Instagram channel

New module `api/src/instagram/`:

- **`zernio.service.ts`** — typed HTTP client against `https://zernio.com/api/v1`
  (`GET /connect/instagram`, `GET /accounts`, `GET /inbox/conversations`,
  `POST /inbox/conversations/{id}/messages`), bearer key from `ZERNIO_API_KEY`.
  **Secret already created:** `arn:aws:secretsmanager:us-east-1:817950288909:secret:whathooks/zernio-api-key-K8C69B`
  — wire it in `infra/lib/whathooks-api-stack.ts` alongside `INCLUDED_AI_OPENAI_KEY`, using that
  **complete** ARN including the random suffix, which that stack requires.
- **Token expiry watchdog** — a scheduled check on `tokenExpiresAt` / `needsReconnection` that emails
  the owner and flips `status` to `DISCONNECTED`, reusing `alertedDisconnectAt` and `alertSession`.
  Without this every connected account dies silently after ~60 days.
- **One Zernio profile per organization.** Created lazily on first connect and stored on
  `Organization` (`zernioProfileId String?`); every `WaSession.externalProfileId` points at it. This
  is the tenant isolation boundary.
- **Connect flow** — `POST /instagram/connect` creates a `WaSession` row with
  `channel: INSTAGRAM, status: PENDING`, calls Zernio for the `authUrl`, returns it; the user
  authorizes with Meta; the `account.connected` webhook (or a polled `GET /v1/accounts`) fills
  `externalAccountId`/`externalHandle` and flips status to `CONNECTED`.
- **Inbound webhooks (Zernio → us)** — `instagram-webhook.controller.ts`. See the dedicated section
  below; this is the operational core of the channel.
- **`InstagramChannelDriver`** implementing `ChannelDriver`: `isLive` = `status === CONNECTED`,
  `sendText`/`sendMedia` via the inbox endpoint, no group primitives. Sends that fail Meta's 24-hour
  window must throw a distinguishable error the callers can surface.

Flows, agents, tags, quick replies, contacts and the inbox then work on Instagram with no further
change — they already operate on `Conversation`/`Message` rows. Four agent prompt strings hardcode
the word "WhatsApp" (`agents/agent-runner.service.ts:208,303,669,717`) and should take the channel
name.

### Webhooks, in both directions

These are two unrelated mechanisms that happen to share a word, and both need work.

**Inbound: Zernio → us.** This replaces the Baileys socket as the source of inbound messages.

- **One endpoint for the whole platform**, not one per organization. Zernio registers webhooks per
  *team* (max 10), so every customer's Instagram traffic arrives at the same URL. Routing is by
  payload: `accountId` → `WaSession.externalAccountId` → `organizationId`. That lookup needs a
  `@@unique` on `externalAccountId`, and an unrecognised `accountId` must 200-and-drop (log it) so a
  stale account at Zernio can't wedge their retry queue.
- **Signature verification needs the raw body.** `X-Zernio-Signature`, verified before parsing.
  `api/src/billing/billing-webhook.controller.ts:25-43` already does exactly this for Stripe —
  copy that raw-body wiring rather than inventing a second approach.
- **Always return 200 quickly, process asynchronously.** Persist and acknowledge, then run
  automation fire-and-forget, the way `runAutomation` is already `void`-called
  (`connection-manager.service.ts:827`). AI replies and flow runs take seconds; a webhook sender
  will not wait.
- **Dedupe on the event `id`** — delivery is documented as at-least-once. New table
  `ExternalEvent { id String @id, receivedAt DateTime }`, inserted before processing; a unique
  violation means "already handled, 200 and stop". This also covers the redelivery that happens
  across an API deploy. Belt and braces: `Message.waMessageId` already carries a unique-ish
  provider id and is used for WhatsApp dedupe (`:648-654`), so reuse it for the Zernio message id.
- **No leader election.** The WhatsApp path holds a Redis lock (`whathooks:session-leader`,
  `:133-140`) so exactly one ECS task owns the sockets. Webhooks are stateless — any task may
  process any event, which makes Instagram strictly simpler to operate and immune to the socket
  handover problems we hit on deploys. The API is already public behind the ALB, so no new infra.
- **Deploy window**: `desiredCount: 1` means a brief gap during rollout. At-least-once retry covers
  it provided we return non-2xx (or nothing) rather than a spurious 200 — do not swallow errors
  before the dedupe row is committed.
- Flow: `message.received` → build an `InboundAutomationCtx` → `MessageStoreService.persist` →
  `WebhookDispatchService.dispatch('message.received')` → `InboundAutomationService.run`.
  Also handle `account.connected` (fills `externalAccountId`/`externalHandle`, status → CONNECTED).

**Outbound: us → customer.** The existing `Webhook` model already fires `message.received` at
customer endpoints — and this is a **breaking change we have to opt customers out of**:

- `Webhook.sessionId` is nullable and **null means org-wide** (`schema.prisma:501-522`). So the
  moment an org connects Instagram, their existing endpoints start receiving Instagram events they
  never subscribed to, with `from` holding an `ig:`-prefixed address where every consumer today
  assumes a phone JID. That will break integrations silently.
- Fix: add `channel Channel?` to `Webhook` (null = all channels) and default **existing** rows to
  `WHATSAPP` in the migration, so current subscribers keep their exact behaviour and Instagram is
  opt-in. New webhooks may choose.
- Add `channel` to the dispatched payload (`connection-manager.service.ts:773-799` builds it today;
  it moves to `MessageStoreService`) so consumers can branch. `isGroup`/`participant`/`mentionedMe`
  are always false/null for Instagram.
- The event catalogue in `api/src/webhooks/dto/webhook.dto.ts:12-17` gains nothing — `message.received`
  and `session.status` cover Instagram as-is; `session.qr` simply never fires for it.

## Phase 2 — Billing: per-account add-on

Stripe today cannot express this: `createCheckoutSession` hardcodes a one-element `line_items` with
`quantity: 1` (`billing.service.ts:146`), `planForPriceId` only scans `PLANS`, and `syncSubscription`
reads `sub.items.data[0]` three times (`:289,295,341`) — Stripe does not guarantee item ordering, so
an add-on item sorting first would poison `stripePriceId` and `currentPeriodEnd`.

1. **Price registry.** New `STRIPE_PRICE_INSTAGRAM_SEAT` env + `INSTAGRAM_SEAT` constant in
   `plans.ts` next to `TOKEN_PACK`, plus `isAddonPriceId(priceId, env)`.
   **Already created (live, 2026-08-11):** product `prod_V3MMBpHiNjRi9C`, price
   `price_1U3FdtHVX3hp29uYzxtCg6YL` — $8.99/month, `billing_scheme: per_unit`,
   `usage_type: licensed`, so subscription-item `quantity` is the number of connected accounts.
   Nothing is charged until this id is wired into a subscription item.
2. **`syncSubscription` iterates items**, classifying each as tier (`planForPriceId`) or add-on.
   Take `plan` and `current_period_end` from the **tier** item; take `quantity` from the add-on item.
   Also relax the `SPONSORED` short-circuit at `:283-287` so comped orgs can still hold an add-on.
3. **Entitlement**: `Organization.instagramSeats Int @default(0)`, written only by
   `syncSubscription` — Stripe stays the single source of truth, the same discipline
   `AiTokenPurchase` follows. Add it to the `orgBilling` select (`quota.service.ts:45-77`).
4. **Seat management endpoint, charged upfront.** `POST /billing/instagram-seats { quantity }` →
   `stripe.subscriptions.update(subId, { items: [{ price, quantity }], proration_behavior: 'always_invoice' })`.
   `always_invoice` — *not* `create_prorations` — is the point: it cuts a prorated invoice and
   charges the card on file immediately, so a seat is paid for before it can be connected. That
   matches our cost shape, since Zernio starts billing per account-day the moment the account
   connects. Consequences to handle:
   - **Seats are entitled only once paid.** The endpoint returns the invoice status; if payment
     fails, `instagramSeats` must not increase. Simplest correct rule: never write the seat count
     from this endpoint — let the resulting `customer.subscription.updated` webhook write it (step 3),
     and treat a failed invoice as "no seat".
   - **Removing a seat mid-cycle produces a credit balance**, not a refund; Stripe applies it to the
     next invoice. Say so in the UI copy before the customer confirms.
   - Requires an active subscription (`assertSubscribed`) and refuses to drop below the number of
     connected IG accounts — the customer disconnects first.
   - This is the first Stripe *write* beyond checkout/portal creation in the codebase.
5. **`assertCanAddInstagramAccount`** in `QuotaService`, in the shape of `assertCanAddNumber`
   (`:359-373`) but comparing `waSession.count({ channel: INSTAGRAM })` against the **purchased**
   `instagramSeats` rather than a `PLANS` constant. `SPONSORED` (i.e. `!planRequiresSubscription`)
   returns early, unlimited.
6. **Handle `invoice.payment_failed`** in `handleEvent` (`:220-265`) — today a failed add-on renewal
   is only caught via an eventual `past_due`, which `ACTIVE_SUBSCRIPTION_STATUSES` still treats as
   fully entitled.

## Phase 3 — Web surfaces

- **Sessions page** becomes channel-aware: a channel badge, "Connect Instagram" alongside "Connect
  number", and the OAuth redirect instead of a QR. Reuse the `new-session-dialog` /
  `connect-number-button` pattern.
- **Inbox**: channel icon on each thread, channel filter beside the existing session filter, and
  `displayHandle` instead of the phone number for IG threads. `web/src/lib/types.ts:150` and
  `web/src/components/messages/types.ts:72-78` gain `channel`.
- **Billing page**: an "Instagram accounts" stepper showing seats purchased vs connected and the
  prorated delta, next to the token-pack card. Note `PLAN_PRICING` in `web/src/lib/types.ts:323-331`
  currently disagrees with `api/.env.example:48-50` on plan prices — reconcile while in there.
- **Pricing/marketing**: add-on line on the pricing page and the plan comparison; per the AI-SEO
  practice already in use, mirror it in `/pricing.md` so agents can read it.
- **i18n**: all new copy in `web/messages/{en,es}.json`. Edit surgically with unique anchors —
  reserialising these files produces 300-line diffs.

## Phase 4 — Cross-channel mirror (the differentiator)

An Instagram lead mirrors into a **WhatsApp group**, so the group primitives stay on the WhatsApp
driver and only the lead side changes. Two additive schema changes:

- `MirrorThread.conversationId String?` → FK to the mirrored `Conversation`. `sessionId` keeps its
  current meaning: the session that **hosts the group**. `leadJid` stays for WhatsApp back-compat,
  and the `@@unique([sessionId, leadJid])` / `@@unique([sessionId, groupJid])` pair still holds.
- `MirrorLink.groupSessionId String?` → which WhatsApp session creates groups for this link
  (null = self, today's behaviour). Required when the link's own session is Instagram.

`mirrorGroupRelay` (`connection-manager.service.ts:906-947`) then resolves group → thread →
conversation and sends through the **router** using `conversation.session.channel`, instead of
assuming the reply goes back over the same socket. `forwardLeadToGroup` (`:950`) is unchanged —
it already targets a WhatsApp group. Human-agent authorization stays phone-number based, since the
people replying are still in a WhatsApp group.

The 24-hour window failure must be visible: when a relay send is rejected, post a system line into
the mirror group saying the Instagram window closed, rather than failing silently.

## Verification

1. `cd api && npx tsc --noEmit && npm test && npx eslint` on touched files; `cd web && npx tsc
   --noEmit && npx eslint` (web is **pnpm** — `npm install` there crashes). Locale JSON parse check.
2. **Zernio spike first, before Phase 1 code**: connect one real Instagram test account, capture an
   actual `message.received` payload and one send response, and deliberately let the 24-hour window
   lapse to see what the send error looks like. The payload shapes in this plan are assumptions
   until this runs.
3. Phase 0 is a pure refactor — verify by exercising WhatsApp end to end with no Instagram
   connected: inbound DM, group message, mirror create/relay/close, flow run, agent reply, media
   both directions. Nothing about WhatsApp behaviour may change.
4. Billing on Stripe **test** mode: buy 2 seats on an existing subscription and confirm an invoice
   is **charged immediately** (not accrued), that the webhook writes `instagramSeats: 2`, and that
   `syncSubscription` still resolves the right plan and period end with two items present. Then:
   raise to 3 with a card that declines and confirm the seat count does **not** move; drop to 0 and
   confirm a credit balance appears rather than a refund; confirm a drop below connected accounts is
   refused. Only then create the live price.
5. Webhook handling: replay the same Zernio event `id` twice and confirm exactly one message row;
   send an event for an unknown `accountId` and confirm a logged 200 with no side effects; tamper
   with the signature and confirm rejection. Confirm an **existing** org-wide customer webhook stops
   at WhatsApp after the migration, and that a new channel-agnostic one receives both.
6. End to end: DM the connected IG account from a personal account → thread appears in the inbox →
   agent replies → assign to a human → mirror group opens on WhatsApp → reply in the group lands in
   Instagram → close the thread.
7. Deploy is CI on push to main (API ~5-10 min on the arm64 runner, web ~1 min on Vercel). The web
   deploying first means a newly-added request field will 400 until the API catches up — expect that
   window and re-test after the API rollout completes.
