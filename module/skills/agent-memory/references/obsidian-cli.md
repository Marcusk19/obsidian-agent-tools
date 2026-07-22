# Obsidian CLI fallback

Use this in Pi or another runtime without Obsidian MCP tools.

```bash
OBSIDIAN_CLI="${OBSIDIAN_CLI_PATH:-/Applications/Obsidian.app/Contents/MacOS/obsidian}"
OBSIDIAN_VAULT_NAME="${OBSIDIAN_VAULT_NAME:-obsidian-git-sync}"
OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-${OBSIDIAN_VAULT:-$HOME/obsidian-git-sync}}"
```

`OBSIDIAN_VAULT_NAME` is the registered name shown by `"$OBSIDIAN_CLI" vaults`;
a filesystem path or `cd` does not select a vault. Verify the configured name is
registered before memory operations. Every command must include the selector:

```bash
"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" search query="..." path="3_Resource/agent memory/"
"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" read path="3_Resource/agent memory/<file>.md"
"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" backlinks path="..."
"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" links path="..."
"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" create path="..." content="..." overwrite
"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" append path="..." content="..."
"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" property:set path="..." name=status value=superseded
```

For multiline content, pass one safely quoted `content=` argument using a shell
variable or short helper. Do not write directly to vault files. After every
write or property change, read the exact path back with the same `vault=`
selector and verify a stable marker. Preserve diagnostics until verification
succeeds.
