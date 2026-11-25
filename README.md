# api-auth-matrix

I am writing a CLI that reads an OpenAPI 3 document, calls every operation as every role, and checks what came back against an access policy.

A role is a name plus headers and cookies. A value can pull from the environment with a `${USER_TOKEN}` placeholder. I treat a 2xx as allowed, a 401 or 403 as denied, and keep any other status as it was. The policy says which roles should be allowed on each operation. The comparison flags a role that got in and should not have, including one user reading another user's resource, and a role that was blocked when the policy says it should pass.

Right now the command parses its flags, loads the spec, and loads the roles file. It checks that the policy path is a file. It does not call the API yet, and it does not print the matrix or write the json and html report.

```
api-auth-matrix ./openapi.yaml --base-url http://127.0.0.1:3000 --roles roles.yaml --policy policy.yaml
```

`--header` can be repeated. `--out` defaults to `./auth-matrix-out`. `--timeout` defaults to 30000 milliseconds.

The roles file is one role per top-level key. `headers` and `cookies` are the only fields. An unknown field is an error. A placeholder whose variable is unset is an error. An empty string counts as set.

```yaml
anonymous: {}

user:
  headers:
    Authorization: Bearer ${USER_TOKEN}

admin:
  headers:
    Authorization: Bearer ${ADMIN_TOKEN}
  cookies:
    session: ${ADMIN_SESSION}

other_user:
  headers:
    Authorization: Bearer ${OTHER_USER_TOKEN}

expired:
  headers:
    Authorization: Bearer ${EXPIRED_TOKEN}
```

`npm run build` compiles to `dist/`. `npm test` runs the unit tests.
