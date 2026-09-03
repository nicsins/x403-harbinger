# AgentMail rail

Harbinger delivery adapter. Not x402. Not authentication.

## Outbound (durable ping)

After a grant settles, if the watch lists `agentmail`:

```
POST /v1/rails/agentmail
X-Harbinger-Grant: hp1.<payload>
Content-Type: application/json

{ "action": "send", "watchId": "w_eth_funding", "to": "desk@agentmail.to" }
```

## Inbound (event source)

AgentMail webhook `message.received` may be forwarded unchanged:

```
POST /v1/rails/agentmail
Content-Type: application/json

{ "type": "event", "event_type": "message.received", "event_id": "evt_...", "message": { ... } }
```

Mapped prints: `mail.received`, `mail.received.8k`.

## Connect (optional live inbox)

```
POST /v1/rails/agentmail
{ "action": "connect", "apiKey": "..." }
```

The key is a mailbox credential. It never replaces `X-Harbinger-Grant`.
