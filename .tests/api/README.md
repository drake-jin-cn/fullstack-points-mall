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
# Install Bruno CLI (first time)
npm install -g @usebruno/cli

# Run entire collection (local environment)
bru run .tests/api/bff/ --env local

# CI output format
bru run .tests/api/bff/ --env local --reporter junit --output test-results/api.xml
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
  "environments": {
    "local": {
      "baseUrl": "http://localhost:3100",
      "testEmail": "test@company.com",
      "testPassword": "Test123456"
    },
    "staging": {
      "baseUrl": "https://staging-api.your-domain.com"
    },
    "production": {
      "baseUrl": "https://api.your-domain.com"
    }
  }
}
```

## Naming Conventions

- File names: `<action>-<scenario>.bru`, e.g. `login-success.bru`, `login-wrong-password.bru`
- `seq` field controls execution order within the same directory
- Each endpoint must cover at minimum: happy path + auth failure (401) + bad request (400)
