# Coolify deployment runbook

The previous VPS and its data were deleted. This repository is configured to build and publish images, but deployment is intentionally disabled until a new server and Coolify application are ready.

## Safety gate

The deploy job runs only when the repository variable `COOLIFY_DEPLOY_ENABLED` is exactly `true`. An absent variable, an empty value, or `false` keeps the job skipped. Image publication, lint, and typecheck continue to run while deployment is disabled.

Do not enable the variable merely to test the workflow. Application startup begins Telegram Bot API polling immediately. With a saved user session it can also start channel monitoring and send a startup notification.

## Future application contract

- Application type: Docker image
- Image: `ghcr.io/dimensi/tg-trip-watcher`
- Image tag: full Git commit SHA
- Proxy, domain, and published ports: none
- Command: `node dist/index.js`
- Restart policy: `unless-stopped`
- Healthcheck: `node -e "process.exit(0)"`, interval 30 seconds, timeout 10 seconds, 3 retries, 20-second start period
- Persistent storage: one new empty volume or bind mount at `/app/data`
- Runtime paths:
  - `SQLITE_PATH=/app/data/tours.db`
  - `CONFIG_PATH=/app/data/config.json`
  - Telegram user session: `/app/data/telegram.session`
- Required runtime secrets: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `BOT_TOKEN`, `OPENROUTER_API_KEY`
- Optional runtime settings: `TELEGRAM_PHONE_NUMBER`, `LOG_LEVEL`, `MT_PROXY`

Keep the whole `/app/data` directory persistent because SQLite may also create `tours.db-wal` and `tours.db-shm`. There is no old database, Telegram session, or JSON configuration to migrate. The first application start creates a fresh database and default configuration; Telegram user authorization must be completed later through the documented onboarding flow.

Use a consistent container name or another single-instance strategy. Do not use rolling overlap: two instances would poll the same bot and may duplicate channel processing or notifications.

## GitHub Actions configuration

| Name | Purpose |
| --- | --- |
| `COOLIFY_URL` secret | Base URL of the future Coolify instance |
| `COOLIFY_APP_UUID` secret | UUID of this application after it is created |
| `COOLIFY_TOKEN` secret | API token used to update the image tag, deploy, and read deployment status |
| `COOLIFY_DEPLOY_ENABLED` variable | Explicit deployment switch; leave absent or `false` until activation |

Create a dedicated Coolify token with `read`, `write`, and `deploy`, the narrowest available scope, and a 90-day lifetime. Use this description:

`tg-trip-watcher GitHub Actions | https://github.com/dimensi/tg-trip-watcher/blob/main/docs/coolify-deployment.md#github-actions-configuration`

Store the token value only in GitHub Actions secrets or a password manager. Record its non-secret ID and expiration in the operations inventory. To rotate it, create the replacement, update `COOLIFY_TOKEN`, verify one intentionally enabled deployment, and only then revoke the old token.

## Activation on a new server

1. Provision and register the new server in Coolify. Configure GHCR access without starting this application.
2. Create the Docker-image application with the contract above and a new empty persistent `/app/data` mount. Keep the application stopped.
3. Add runtime secrets and settings in Coolify. Do not copy them into repository variables or workflow files.
4. Add `COOLIFY_URL`, `COOLIFY_APP_UUID`, and `COOLIFY_TOKEN` to GitHub Actions secrets.
5. Review the target server, image, mount, environment-key names, and single-instance settings.
6. Set `COOLIFY_DEPLOY_ENABLED=true` only when starting the bot is explicitly intended, then manually dispatch `Deploy` from `main`.
7. Verify the exact full-SHA image, persistent `/app/data` mount, container health, restart count, and startup logs. Complete Telegram onboarding separately; do not send test messages as part of deployment verification.

To pause future deployments without stopping an existing application, set `COOLIFY_DEPLOY_ENABLED=false` or remove the variable. If activation fails, disable the variable first, stop the application in Coolify, and inspect the new empty data volume without deleting it.
