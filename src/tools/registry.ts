/**
 * Tool Registry — all tools register here and are discoverable by the agent.
 *
 * Each tool has:
 *  - name: unique identifier used in LLM tool calls
 *  - description: tells the LLM when/how to use it
 *  - parameters: JSON Schema for the tool's inputs
 *  - handler: the function that executes when called
 *
 * The registry exports:
 *  - getToolDefinitions(): tool schemas for the LLM system prompt
 *  - executeTool(name, args): dispatches a tool call to its handler
 */

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, ToolParameter>;
  required?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface Tool extends ToolDefinition {
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

const tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  if (tools.has(tool.name)) {
    throw new Error(`Tool already registered: ${tool.name}`);
  }
  tools.set(tool.name, tool);
}

/** Get all tool definitions (for LLM system prompt / tools array) */
export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values()).map(({ handler: _, ...def }) => def);
}

/** Execute a tool by name */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.handler(args);
}

/** List all registered tool names */
export function getToolNames(): string[] {
  return Array.from(tools.keys());
}

/** Number of registered tools */
export function getToolCount(): number {
  return tools.size;
}
