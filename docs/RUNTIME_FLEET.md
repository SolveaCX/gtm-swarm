# Runtime Fleet

GTM Swarm owns the runtime fleet registry. Multica owns the actual runtime listener records.

## Add A Machine

1. Add the machine to `config/runtime-machines.yaml`.
2. Declare capabilities honestly. Do not list `x_automation` unless the machine has the X stack and credentials.
3. Add expected local paths under `paths`.
4. Add env variable names only. Never commit secret values.
5. Commit the registry update.

## Check A Machine

Run this on the target machine:

```bash
gtm runtime update-scripts
gtm runtime doctor --machine boyuan-mac-mini
```

`doctor` exits `0` when all declared machine-level env and paths exist. It exits `2` when config is incomplete.

## What The Common Requirements Mean

`x_agent` is not an environment variable. It is the local filesystem path for the X automation stack, declared in `config/runtime-machines.yaml`:

```yaml
paths:
  x_agent: /Users/siliconno3/x_agent
```

The X Growth Agent template lists `x_agent` under `local_paths.required` so the workspace setup issue can tell the operator which local codebase must exist before the agent can run.

`GTM_WRITES_TOKEN` is the bearer token used by local machine commands to call GTM Swarm write APIs, including `/api/runtime/register`. It should be available on any machine that runs:

```bash
gtm runtime register ...
gtm runtime listen ...
```

Agent templates list required environment variables under `environment.required`. These names are copied into each Multica agent's `runtime_config` when the template is installed, so setup work is visible at agent creation time.

## Register A Machine To A Workspace

Run:

```bash
gtm runtime plan --workspace voc-ai
gtm runtime register --machine boyuan-mac-mini --workspace voc-ai --profiles local-x-runtime,local-reddit-runtime
```

`register` calls GTM Swarm, which writes runtime listener rows into Multica and returns runtime IDs.

## Start Listening

Run:

```bash
gtm runtime listen --machine boyuan-mac-mini --workspace voc-ai --profiles local-x-runtime,local-reddit-runtime
```

Version 1 registers the channel and prints the runtime IDs. The next iteration should poll Multica's task queue and execute work for those runtime IDs.

## Update Scripts Later

On each machine:

```bash
gtm runtime update-scripts
```

This runs `git pull --rebase` and `npm install` in the GTM Swarm repo. If the repo has local changes, the command fails and the operator must resolve them.
