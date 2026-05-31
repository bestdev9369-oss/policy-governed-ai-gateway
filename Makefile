# Convenience targets for local development.
# Requires: Docker, Node.js >= 20, pnpm >= 9
# On Windows: use Git Bash, WSL, or run the pnpm commands directly.

.PHONY: install setup dev test build clean docker-up docker-down

## install: install all workspace dependencies
install:
	pnpm install

## setup: full first-run setup (install + infra + migrate + seed)
setup: install docker-up
	@echo "Waiting for Postgres to be ready..."
	@sleep 5
	pnpm db:migrate
	pnpm db:seed
	@echo ""
	@echo "  Setup complete."
	@echo "  Start API:       pnpm --filter @pgag/api dev"
	@echo "  Start dashboard: pnpm --filter @pgag/web dev"
	@echo ""

## dev: start API and dashboard in parallel (requires two terminals or a process manager)
dev:
	pnpm --filter @pgag/api dev & pnpm --filter @pgag/web dev

## test: run all tests
test:
	pnpm test

## test-policy: run policy engine tests only (no DB required)
test-policy:
	pnpm --filter @pgag/policy-engine test

## build: typecheck and compile all packages
build:
	pnpm --filter @pgag/shared build
	pnpm --filter @pgag/policy-engine build
	pnpm --filter @pgag/api build
	pnpm --filter @pgag/web build

## docker-up: start Postgres and Redis
docker-up:
	docker compose -f deploy/docker-compose.yml up -d

## docker-down: stop all containers
docker-down:
	docker compose -f deploy/docker-compose.yml down

## docker-logs: tail logs from all services
docker-logs:
	docker compose -f deploy/docker-compose.yml logs -f

## clean: remove build artifacts
clean:
	find . -name "dist" -not -path "*/node_modules/*" -type d -exec rm -rf {} + 2>/dev/null; true

help:
	@grep -E '^## ' Makefile | sed 's/## /  /'
