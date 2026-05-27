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
