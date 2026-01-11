# Testing Guide

This project uses a dedicated Supabase test database. Tests reset and seed the DB to keep results deterministic.

## Setup

1) Create a Supabase **test** project and clone the schema.
2) Create `.env.test` (use `.env.test.example` as a template).
3) Ensure the test admin credentials match:
   - `TEST_ADMIN_EMAIL`
   - `TEST_ADMIN_PASSWORD`

## Reset + seed the test DB

```
npm run test:reset-db
```

## Run unit + integration tests

```
npm run test:unit
```

## Run style build check

```
npm run test:styles
```

## Run end-to-end (Playwright) tests

```
npm run test:e2e
```

If Playwright browsers are not installed yet:

```
npx playwright install
```

## Run everything

```
npm test
```

## Notes

- Tests run with `NODE_ENV=test` and `EMAIL_MODE=disabled` to avoid external email.
- Playwright starts the server on port `3100` by default.
- If Playwright fails to start, ensure `DATABASE_URL_TEST` is set and reachable.
