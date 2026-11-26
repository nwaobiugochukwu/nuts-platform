# How production teams run several services

Plain-language background for why this repository starts and deploys the way it does. It describes common practice, not a standard everyone follows.

## The idea in one paragraph

A team builds **one image** (a sealed package of the code) once. A platform then runs several **copies of it, each told to do a different job**: serve requests, consume messages, run scheduled jobs. The platform watches each copy, restarts it if it dies, and only sends traffic to it when its health check passes. Passwords and settings are injected from outside, and databases are managed services, not something the team runs. Here: Render is the platform, and `PM2_APP` tells a copy which job it does.

## Who does what in each setting

| Setting | What starts the services | What watches them |
|---|---|---|
| Production-style platform (Render, Kubernetes, ECS) | the platform, from the image | the platform's health checks and restarts |
| Local, production-like | Docker Compose or Tilt runs the same containers | Docker restarts |
| Local, day to day | a launcher, a Procfile runner or the monorepo task runner | a process supervisor (PM2 here), or the developer |

Most teams do not use one tool in every row. What matters is that **every setting runs the same programs with the same settings names**, so a surprise on staging is rare. PM2 here is that shared supervisor: the same restart behaviour in the container and on a laptop.

## Order of start

Platforms start services independently and rely on health checks plus retries, so no service may assume another is already up. Locally, starting in a fixed order with a health check between steps makes the log readable and failures obvious. That is what `npm run dev` does: data services, compiler, api, worker, jobs, web. The order is a convenience, not a dependency: each service still copes with the others being slow or restarting.

## Where this repository sits

| Practice | Here |
|---|---|
| One image, many roles | one api image; `PM2_APP` picks web/api/worker/jobs (the Temporal worker uses its own image because its native library needs a different base) |
| Health checks | api `/api/v1/health`, worker and jobs on their own ports, `scripts/verify-deploy.sh` |
| Restarts | PM2 in every environment |
| Managed data | Supabase (Postgres), Redis Cloud, hosted RabbitMQ |
| Observability | metrics, dashboard and alerts locally; Grafana Cloud on staging (to be set up) |
| Gated deploys | planned: a check that runs after every merge |

See [How the system works](how-it-works.md), [ADR 0004](adr/0004-operational-safety-and-environment-parity.md) and [Running and testing locally](../operations/local-development.md).
