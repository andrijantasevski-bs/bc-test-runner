/**
 * BC Test Runner - Zod Schemas
 *
 * Type-safe validation schemas for bctest.config.json
 */

import { z } from "zod";

/* eslint-disable @typescript-eslint/naming-convention */

// Environment schema
export const EnvironmentSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().optional(),
  type: z.enum(["docker", "server"]),
  containerName: z.string().min(1),
  server: z.string().regex(/^https?:\/\/.+/),
  serverInstance: z.string().default("BC"),
  authentication: z.enum(["UserPassword", "Windows", "NavUserPassword"]),
  tenant: z.string().optional().default("default"),
});

// Test app schema
export const TestAppSchema = z.object({
  path: z.string().min(1),
  extensionId: z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    ),
  extensionName: z.string().min(1),
  testCodeunitRange: z
    .string()
    .regex(/^[0-9]+(\.\.)?[0-9]*$/)
    .optional()
    .default("80000..80099"),
});

// Output schema
export const OutputSchema = z.object({
  resultsFolder: z.string().default("TestApp/.testresults"),
  customDirectory: z.string().optional(),
  keepHistoryCount: z.number().int().min(1).max(100).default(10),
  formats: z.array(z.string()).default(["json", "xml", "html"]),
  includePassedTests: z.boolean().optional().default(true),
});

// Test execution schema
export const TestExecutionSchema = z
  .object({
    timeout: z.number().int().min(30).max(3600).optional().default(600),
    retryFailedTests: z.boolean().optional().default(false),
    parallelExecution: z.boolean().optional().default(false),
  })
  .optional();

// Main config schema
export const BCTestConfigSchema = z.object({
  $schema: z.string().optional(),
  workspacePath: z.string().optional().default("../"),
  defaultEnvironment: z.string().min(1),
  apps: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .default(["App", "TestApp"]),
  testApp: TestAppSchema,
  environments: z.array(EnvironmentSchema).min(1),
  output: OutputSchema,
  testExecution: TestExecutionSchema,
});

// Infer TypeScript types from schemas
export type BCTestConfig = z.infer<typeof BCTestConfigSchema>;
export type BCTestEnvironment = z.infer<typeof EnvironmentSchema>;
export type TestApp = z.infer<typeof TestAppSchema>;
export type OutputConfig = z.infer<typeof OutputSchema>;
export type TestExecutionConfig = z.infer<typeof TestExecutionSchema>;
