#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load environment variables from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: `${__dirname}/../.env` });

// Validate required environment variables
const requiredEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const cloudwatchlogs = new AWS.CloudWatchLogs();

class CloudWatchServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'cloudwatch-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_log_groups',
          description: 'List CloudWatch Log Groups',
          inputSchema: {
            type: 'object',
            properties: {
              prefix: {
                type: 'string',
                description: 'Log group name prefix filter',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of log groups to return',
                minimum: 1,
                maximum: 50,
              },
            },
          },
        },
        {
          name: 'list_log_streams',
          description: 'List CloudWatch Log Streams in a Log Group',
          inputSchema: {
            type: 'object',
            properties: {
              logGroupName: {
                type: 'string',
                description: 'Name of the log group',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of log streams to return',
                minimum: 1,
                maximum: 50,
              },
            },
            required: ['logGroupName'],
          },
        },
        {
          name: 'get_log_events',
          description: 'Get log events from a log stream',
          inputSchema: {
            type: 'object',
            properties: {
              logGroupName: {
                type: 'string',
                description: 'Name of the log group',
              },
              logStreamName: {
                type: 'string',
                description: 'Name of the log stream',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of log events to return',
                minimum: 1,
                maximum: 100,
              },
              startTime: {
                type: 'number',
                description: 'Start time in milliseconds since epoch',
              },
              endTime: {
                type: 'number',
                description: 'End time in milliseconds since epoch',
              },
            },
            required: ['logGroupName', 'logStreamName'],
          },
        },
      ],
    }));

    // Implement tool handlers
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'list_log_groups':
          return this.handleListLogGroups(request.params.arguments);
        case 'list_log_streams':
          return this.handleListLogStreams(request.params.arguments);
        case 'get_log_events':
          return this.handleGetLogEvents(request.params.arguments);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }
    });
  }

  private async handleListLogGroups(args: any) {
    const params = {
      logGroupNamePrefix: args.prefix,
      limit: args.limit || 10,
    };

    try {
      const result = await cloudwatchlogs.describeLogGroups(params).promise();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.logGroups || [], null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list log groups: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleListLogStreams(args: any) {
    if (!args.logGroupName) {
      throw new McpError(ErrorCode.InvalidParams, 'logGroupName is required');
    }

    const params = {
      logGroupName: args.logGroupName,
      limit: args.limit || 10,
      orderBy: 'LastEventTime',
      descending: true
    };

    try {
      const result = await cloudwatchlogs.describeLogStreams(params).promise();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.logStreams || [], null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list log streams: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetLogEvents(args: any) {
    if (!args.logGroupName || !args.logStreamName) {
      throw new McpError(ErrorCode.InvalidParams, 'logGroupName and logStreamName are required');
    }

    const params = {
      logGroupName: args.logGroupName,
      logStreamName: args.logStreamName,
      limit: args.limit || 10,
      startTime: args.startTime,
      endTime: args.endTime,
    };

    try {
      const result = await cloudwatchlogs.getLogEvents(params).promise();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.events || [], null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get log events: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[INFO] CloudWatch MCP server running on stdio');
  }
}

const server = new CloudWatchServer();
server.run().catch(console.error);