#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerVaultTools } from "./tools/vault.js";
import { registerReadTools } from "./tools/read.js";
import { registerSearchTools } from "./tools/search.js";
import { registerGraphTools } from "./tools/graph.js";
import { registerTagsTools } from "./tools/tags.js";
import { registerPropertiesTools } from "./tools/properties.js";
import { registerTasksTools } from "./tools/tasks.js";
import { registerAliasesTools } from "./tools/aliases.js";
import { registerWriteTools } from "./tools/write.js";
import { registerManageTools } from "./tools/manage.js";
import { registerPropertyWriteTools } from "./tools/property-write.js";
import { registerTaskUpdateTools } from "./tools/task-update.js";
import { registerSessionTools } from "./tools/session.js";
import { registerSearchSessionsTools } from "./tools/search-sessions.js";
import { registerVaultSearchTools } from "./tools/search-vault.js";

const server = new McpServer({
  name: "obsidian",
  version: "1.0.0",
});

registerVaultTools(server);
registerReadTools(server);
registerSearchTools(server);
registerGraphTools(server);
registerTagsTools(server);
registerPropertiesTools(server);
registerTasksTools(server);
registerAliasesTools(server);
registerWriteTools(server);
registerManageTools(server);
registerPropertyWriteTools(server);
registerTaskUpdateTools(server);
registerSessionTools(server);
registerSearchSessionsTools(server);
registerVaultSearchTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
