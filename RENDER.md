# Render database setup for Hidden Hunter maps

Custom Hidden Hunter maps are stored in PostgreSQL. The backend reads the connection string from `process.env.DATABASE_URL`. The URL is not hardcoded, and it must not be committed to this repository or placed in frontend JavaScript.

The `pg` package connects with a pool, creates the `hh_maps` table if needed, and uses that table for insert, update, and select. A save succeeds only after PostgreSQL confirms the row. If `DATABASE_URL` is missing, database initialization fails with `DATABASE_URL is missing` and map saves are rejected.

## Configure the backend

Render Dashboard
→ Backend Web Service
→ Environment
→ Add Environment Variable

Name:

DATABASE_URL

Value:

the connection URL supplied by the persistent PostgreSQL database.

Use the web service that is deployed at `https://cardb-2uys.onrender.com`. Save the variable. Render restarts the service with the new environment.

## Where the value comes from

Create a persistent PostgreSQL database, then copy its connection URL into `DATABASE_URL`.

On Render, that database is a Render Postgres instance:

1. Render Dashboard → New → PostgreSQL.
2. Create the database and wait until it is available.
3. Open the database → Connections.
4. Copy the internal connection URL when the database and the web service are in the same region. Copy the external connection URL when they are not.
5. Paste that URL as the `DATABASE_URL` value on the backend web service. Do not paste it into this repository, the frontend, or a log.

Any other persistent PostgreSQL host works the same way. Put only its connection URL in `DATABASE_URL`.

The server creates this table on startup:

`hh_maps (id text primary key, document jsonb not null)`

Saving a new map inserts a row. Saving an existing map updates the row with the same id.

## After it is set

Redeploy or let Render finish the restart caused by the new variable. Save a map, reload the site, and restart the backend. The map should still be listed. This repository cannot confirm that the live service is connected until `DATABASE_URL` is set on that service.
