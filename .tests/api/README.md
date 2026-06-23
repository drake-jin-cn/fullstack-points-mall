# API Test Conventions (Bruno)

Bruno is an open-source API client (alternative to Postman). Test files are stored in
plain-text `.bru` format, which is Git-friendly and supports CLI execution.

## Directory Structure

```
.tests/api/
├── bff/
│   ├── auth/
│   │   ├── login.bru
│   │   └── refresh-token.bru
│   ├── points/
│   └── shop/
└── bruno.json          # environment variable config
```

## Run Commands

```bash
# Run tests for a specific task (recommended — uses project-local bru)
pnpm run test:task TASK-INFRA-0001

# Run tests and auto-update task status
pnpm run test:task TASK-INFRA-0001 --update-status

# Run all dev-done tasks
pnpm run test:task --status=dev-done --update-status

# Run Bruno directly against a service collection (project-local bru)
pnpm exec bru run .tests/api/bff/ --env local

# Run a single .bru file
pnpm exec bru run .tests/api/bff/health/health.bru --env local

# CI output format (JUnit XML)
pnpm exec bru run .tests/api/bff/ --env local --reporter junit --output test-results/api.xml
```

## .bru File Format

```
meta {
  name: Employee login with credentials - happy path
  type: http
  seq: 1
}

post {
  url: {{baseUrl}}/api/auth/login
  body: json
  auth: none
}

body:json {
  {
    "email": "{{testEmail}}",
    "password": "{{testPassword}}"
  }
}

assert {
  res.status: eq 200
  res.body.code: eq 0
  res.body.data.token: isDefined
  res.body.data.user.id: isDefined
  res.body.data.user.email: eq {{testEmail}}
}
```

## Environment Config (bruno.json)

```json
{
  "version": "1",
  "name": "Points Mall API Tests",
  "environments": {
    "local": {
      "bffBaseUrl": "http://localhost:4000",
      "coreBaseUrl": "http://localhost:8080",
      "shopBaseUrl": "http://localhost:8081",
      "messageBaseUrl": "http://localhost:8082",
      "thirdpartyBaseUrl": "http://localhost:8084",
      "dataBaseUrl": "http://localhost:8083",
      "frontendBaseUrl": "http://localhost:3000"
    },
    "staging": {
      "bffBaseUrl": "https://staging-bff.your-domain.com",
      "coreBaseUrl": "https://staging-core.your-domain.com",
      "shopBaseUrl": "https://staging-shop.your-domain.com",
      "messageBaseUrl": "https://staging-message.your-domain.com",
      "thirdpartyBaseUrl": "https://staging-thirdparty.your-domain.com",
      "dataBaseUrl": "https://staging-data.your-domain.com",
      "frontendBaseUrl": "https://staging.your-domain.com"
    }
  }
}
```

## Naming Conventions

- File names: `<action>-<scenario>.bru`, e.g. `login-success.bru`, `login-wrong-password.bru`
- `seq` field controls execution order within the same directory
- Each endpoint must cover at minimum: happy path + auth failure (401) + bad request (400)
