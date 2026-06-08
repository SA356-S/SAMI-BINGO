# Verifier API — local setup for EDIL Bingo

Independent service cloned from [Vixen878/verifier-api](https://github.com/Vixen878/verifier-api).

## Port

Default **port 3002** in `.env` because the bingo backend already uses **3001**.

To run verifier on 3001 instead: set `PORT=3001` in `verifier-api/.env` and move the bingo backend to e.g. `PORT=3000`.

## Install & run

```bash
cd verifier-api
npm install
npx prisma generate
npm run dev
```

Health check: http://localhost:3001/health

## Local auth bypass

`.env` includes `SKIP_API_KEY_AUTH=true` so the bingo backend can call verify endpoints without a database API key during development.

For production, set `SKIP_API_KEY_AUTH=false`, configure `DATABASE_URL` (MySQL), and generate a key:

```bash
curl -X POST http://localhost:3001/admin/api-keys \
  -H "x-admin-key: bingo-local-admin" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"edil-bingo\"}"
```

Put the returned key in `backend/.env` as `VERIFIER_API_KEY`.

## Endpoints used by bingo backend

| Method | Path | Body |
|--------|------|------|
| GET | `/health` | — |
| POST | `/verify-telebirr` | `{ "reference": "CE..." }` |
| POST | `/verify-cbebirr` | `{ "receiptNumber": "...", "phoneNumber": "2519..." }` |
