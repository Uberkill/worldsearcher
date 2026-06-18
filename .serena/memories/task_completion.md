# Task Completion
A coding task is considered done when:
1. `npm run lint` produces no unused variable warnings or React Hooks violations.
2. `npm run test:unit` passes successfully.
3. If core engine logic, ECS states, or architectural patterns were modified, the `version` inside `docs/canary_tracker.json` MUST be incremented. The CI pipeline will fail if this is ignored.