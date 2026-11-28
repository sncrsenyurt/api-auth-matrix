# api-auth-matrix

I am writing a CLI that reads an OpenAPI 3 document, calls every operation as every role, and checks what came back against an access policy.

A role is a name plus headers and cookies. A value can pull from the environment with a `${USER_TOKEN}` placeholder. I treat a 2xx as allowed, a 401 or 403 as denied, and keep any other status as it was. The policy says which roles should be allowed on each operation. The comparison flags a role that got in and should not have, including one user reading another user's resource, and a role that was blocked when the policy says it should pass.

The spec loader follows local `$ref` pointers when it lists operations. I build a single call from examples, defaults, and enums. A role can carry resource ids, and the policy can map a parameter name onto one of those ids, so user A and user B use different order ids.

The command calls each operation as each role and prints each mismatch: escalation, object-level, missing-auth, or over-blocked. A 2xx is allowed, 401 and 403 are denied, a network failure or timeout is an error, and any other status stays as it was. It still does not draw the matrix or write the json and html report.

```
api-auth-matrix ./openapi.yaml --base-url http://127.0.0.1:3000 --roles roles.yaml --policy policy.yaml
```

`--header` can be repeated. `--out` defaults to `./auth-matrix-out`. `--timeout` defaults to 30000 milliseconds.

The roles file is one role per top-level key. `headers`, `cookies`, and `resources` are the only fields. An unknown field is an error. A placeholder whose variable is unset is an error. An empty string counts as set.

```yaml
anonymous: {}

user:
  headers:
    Authorization: Bearer ${USER_TOKEN}
  resources:
    orderId: ord-a

admin:
  headers:
    Authorization: Bearer ${ADMIN_TOKEN}
  cookies:
    session: ${ADMIN_SESSION}

other_user:
  headers:
    Authorization: Bearer ${OTHER_USER_TOKEN}
  resources:
    orderId: ord-b

expired:
  headers:
    Authorization: Bearer ${EXPIRED_TOKEN}
```

The policy names an operation. `allow` is a list of role names, or `public`, `admin only`, or `owner only`. When a path parameter is not the resource name, `resources` points it at one.

```yaml
getHealth:
  allow: public

getReport:
  allow: admin only

getOrder:
  allow: owner only
  resources:
    id: orderId
```

`npm run build` compiles to `dist/`. `npm test` runs the unit tests.
