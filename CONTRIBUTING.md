# Contributing

## Development setup

```bash
git clone https://github.com/your-username/policy-governed-ai-gateway
cd policy-governed-ai-gateway
make setup    # or: pnpm install && pnpm docker:up && pnpm db:migrate && pnpm db:seed
```

## Running locally

```bash
pnpm --filter @pgag/api dev     # API on :3000, hot reload
pnpm --filter @pgag/web dev     # Dashboard on :5173, hot reload
```

## Tests

```bash
pnpm test                            # all tests
pnpm --filter @pgag/policy-engine test  # policy engine only (fast, no DB)
```

The policy engine tests run with no database or Docker dependency. All business logic correctness tests live there.

## Code conventions

- TypeScript strict mode throughout
- No `any` without a comment explaining why
- Pure functions where possible — side effects at the edges
- Every DB write that changes request status must also write an audit log entry
- Policy engine must remain a pure package with no I/O dependencies

## Adding a new policy condition

1. Add the field to `PolicyRule` in `packages/shared/src/types.ts`
2. Add the column to `policies` table in `apps/api/src/db/schema.ts`
3. Add the gate check in `packages/policy-engine/src/evaluator.ts` (`checkConditions`)
4. Add a test case in `packages/policy-engine/tests/evaluator.test.ts`
5. Update `docs/architecture.md` and the README policy table

## Adding a new tool to the mock executor

Add a handler to the `TOOL_HANDLERS` map in `apps/api/src/services/tool-executor.ts` and a token profile in `apps/api/src/services/cost-estimator.ts`.
