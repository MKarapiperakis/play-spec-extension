# PlaySpec (VS Code extension)

Generate a runnable [Playwright](https://playwright.dev/docs/api-testing) API test project from an
OpenAPI/Swagger spec, directly inside your existing workspace — no need to use the PlaySpec web tool
and download a zip.

Reads a spec from a **local file** or a **live URL**, groups endpoints by tag, fills in sample
parameter/body values from the spec's own examples/defaults/schemas, wires up the spec's declared
authentication schemes (bearer, basic, API key), and writes a self-contained test project to a
`playwright-tests/` folder (configurable) at the root of your workspace.

## Commands

- **PlaySpec: Generate Playwright Tests from Spec File...** — pick a local `.json`/`.yaml`/`.yml` spec.
- **PlaySpec: Generate Playwright Tests from Spec URL...** — fetch a spec from a live URL.
- **PlaySpec: Generate Playwright Tests from This Spec** — right-click a spec file in the Explorer.

## What gets generated

```
playwright-tests/
├── package.json
├── playwright.config.ts
├── .env.sample          # copy to .env and fill in credentials / base URL
├── README.md
└── tests/
    ├── helpers/
    │   ├── assertSchema.ts
    │   ├── url.ts            # only if the spec has path/required-query params
    │   └── auth/*.ts          # one file per detected security scheme
    ├── data/
    │   └── params.ts          # editable placeholder values for path/query params
    └── spec/
        └── <tag>.spec.ts       # one file per OpenAPI tag, one test() per operation
```

After generation, run:

```bash
cd playwright-tests
npm install
npx playwright install
cp .env.sample .env   # fill in credentials / base URL
npm test
```

## Settings

- `playspec.outputFolderName` (default `"playwright-tests"`) — the folder name created at the workspace root.
- `playspec.skipResponseValidation` (default `false`) — default value written into the generated `.env.sample`.

## Known limitations

- Only `application/json` request/response bodies are handled.
- Only the first alternative in an operation's `security` requirements is used (schemes within that
  one alternative are all merged in).
- OAuth2, OpenID Connect, and cookie-based auth are detected but not generated — add them manually.
- Example values are generated deterministically from the spec (`example`/`default`/`enum`/schema
  type), not randomized.
