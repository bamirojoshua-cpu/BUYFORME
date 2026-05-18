# verify_paystack_payment (Supabase Edge Function)

Verifies a Paystack transaction reference and marks a `requests` row as `paid`.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYSTACK_SECRET_KEY`

## Request

`POST` JSON body:

```json
{ "order_id": "<uuid>", "reference": "BFM_<...>" }
```

Requires an `Authorization: Bearer <user_jwt>` header (the buyer).

## Notes

- The function computes the **expected amount** from `requests.total_amount` and compares it to Paystack’s verified `amount`.
- The function only allows verification when the order `status` is `accepted` (or `payment` if you still use it).

