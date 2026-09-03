# Harbinger

**Designation:** `x403-HARBINGER/1.0`  
**Document:** `X403-HP-1`  
**URN:** `urn:x403:harbinger:1.0`  
**Status:** HTTP 403 Forbidden until grant

Harbinger is an HTTP-native protocol that lets one agent charge another for a notification when a named event — or a correlated set of events — occurs.

Unpaid callers receive **403 Forbidden**. Present `X-Harbinger-Grant`. The edge settles and pushes.

This is not pay-for-a-resource. It is grant-required notify.

## Spec

- [SPEC.md](./SPEC.md) — X403-HP-1, the 1.0 memo
- [spec/harbinger-1.0.json](./spec/harbinger-1.0.json) — machine document

## Wire format

```
GET /v1/stream
X-Harbinger-Watch: w_eth_funding

HTTP/1.1 403 Forbidden
X-Harbinger-Version: x403-HARBINGER/1.0
X-Harbinger-Forbidden: grant-required
X-Harbinger-Price: 0.08 USDC
X-Harbinger-Advantage-Window: 840ms
```

Retry with:

```
X-Harbinger-Grant: hp1.<payload>
```

## Discovery

Publishers serve `/.well-known/harbinger` as `application/vnd.x403.harbinger+json`.

## Citation

nicsins, "Harbinger: Agent Grant and Notification Protocol", X403-HP-1, x403-HARBINGER/1.0, September 2026.

## License

MIT
