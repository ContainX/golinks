-- Runs once, the first time the postgres container initialises an empty data
-- directory. Executed by the image entrypoint through psql as the superuser
-- named by POSTGRES_USER, connected to POSTGRES_DB.
--
-- It installs the two extensions the service requires (spec 09 section 1) in the
-- application database, then creates a second database for the API integration
-- suite and installs them there too.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- CREATE DATABASE cannot run inside a transaction or a DO block, so build the
-- statement and hand it to psql's \gexec. The guard keeps the script re-runnable.
SELECT format('CREATE DATABASE %I OWNER %I', 'golinks_test', current_user)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'golinks_test')
\gexec

\connect golinks_test

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
