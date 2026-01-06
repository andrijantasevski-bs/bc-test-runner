/**
 * BC Test Runner - Configuration Manager
 *
 * Handles loading, validating, and managing bctest.config.json files
 * across single and multi-root workspaces.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  BCTestConfig,
  BCTestEnvironment,
} from "../powershell/PowerShellRunner";

/**
 * Configuration manager for BC Test Runner
 */
export class ConfigManager {
  private _cachedConfig: BCTestConfig | null = null;
  private _cachedConfigPath: string | null = null;
  private _fileWatcher: vscode.FileSystemWatcher | null = null;

  constructor() {
    // Set up file watcher for config changes
    this._setupFileWatcher();
  }

  /**
   * Set up file system watcher for config changes
   */
  private _setupFileWatcher(): void {
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/bctest.config.json"
    );

    this._fileWatcher.onDidChange(() => {
      this._invalidateCache();
    });

    this._fileWatcher.onDidCreate(() => {
      this._invalidateCache();
    });

    this._fileWatcher.onDidDelete(() => {
      this._invalidateCache();
    });
  }

  /**
   * Invalidate the cached configuration
   */
  private _invalidateCache(): void {
    this._cachedConfig = null;
    this._cachedConfigPath = null;
  }

  /**
   * Find bctest.config.json in the workspace
   * Searches workspace folders and common locations
   */
  async findConfigFile(): Promise<string | undefined> {
    // Check cache first
    if (this._cachedConfigPath && fs.existsSync(this._cachedConfigPath)) {
      return this._cachedConfigPath;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return undefined;
    }

    // Search locations in order of preference
    const searchPatterns = [
      "bctest.config.json",
      "BCTestRunner/bctest.config.json",
      ".vscode/bctest.config.json",
    ];

    for (const folder of workspaceFolders) {
      for (const pattern of searchPatterns) {
        const configPath = path.join(folder.uri.fsPath, pattern);
        if (fs.existsSync(configPath)) {
          this._cachedConfigPath = configPath;
          return configPath;
        }
      }
    }

    // Try glob search as fallback
    const files = await vscode.workspace.findFiles(
      "**/bctest.config.json",
      "**/node_modules/**",
      1
    );
    if (files.length > 0) {
      this._cachedConfigPath = files[0].fsPath;
      return this._cachedConfigPath;
    }

    return undefined;
  }

  /**
   * Find all bctest.config.json files in multi-root workspace
   */
  async findAllConfigFiles(): Promise<string[]> {
    const files = await vscode.workspace.findFiles(
      "**/bctest.config.json",
      "**/node_modules/**"
    );
    return files.map((f) => f.fsPath);
  }

  /**
   * Load configuration from file
   */
  async loadConfig(configPath: string): Promise<BCTestConfig> {
    // Check cache
    if (this._cachedConfig && this._cachedConfigPath === configPath) {
      return this._cachedConfig;
    }

    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, "utf-8");
    let config: BCTestConfig;

    try {
      config = JSON.parse(content) as BCTestConfig;
    } catch (e) {
      throw new Error(
        `Invalid JSON in configuration file: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    // Validate required fields
    this._validateConfig(config, configPath);

    // Resolve relative paths
    const configDir = path.dirname(configPath);
    if (config.workspacePath) {
      config.workspacePath = path.resolve(configDir, config.workspacePath);
    } else {
      config.workspacePath = configDir;
    }

    // Cache the config
    this._cachedConfig = config;
    this._cachedConfigPath = configPath;

    return config;
  }

  /**
   * Validate configuration structure
   */
  private _validateConfig(config: BCTestConfig, configPath: string): void {
    const errors: string[] = [];

    if (!config.defaultEnvironment) {
      errors.push("Missing required field: defaultEnvironment");
    }

    if (!config.testApp) {
      errors.push("Missing required field: testApp");
    } else {
      if (!config.testApp.extensionId) {
        errors.push("Missing required field: testApp.extensionId");
      }
      if (!config.testApp.extensionName) {
        errors.push("Missing required field: testApp.extensionName");
      }
    }

    if (!config.environments || config.environments.length === 0) {
      errors.push(
        "Missing required field: environments (must have at least one environment)"
      );
    } else {
      config.environments.forEach((env, index) => {
        if (!env.name) {
          errors.push(`Environment ${index}: missing required field 'name'`);
        }
        if (!env.containerName) {
          errors.push(
            `Environment ${
              env.name || index
            }: missing required field 'containerName'`
          );
        }
        if (!env.server) {
          errors.push(
            `Environment ${env.name || index}: missing required field 'server'`
          );
        }
        if (!env.authentication) {
          errors.push(
            `Environment ${
              env.name || index
            }: missing required field 'authentication'`
          );
        }
      });
    }

    if (errors.length > 0) {
      throw new Error(
        `Invalid configuration in ${configPath}:\n${errors.join("\n")}`
      );
    }
  }

  /**
   * Get the results folder path from config
   */
  getResultsFolder(config: BCTestConfig): string {
    if (config.output?.customDirectory) {
      return config.output.customDirectory;
    }

    const resultsFolder = config.output?.resultsFolder || ".testresults";
    return path.join(config.workspacePath, resultsFolder);
  }

  /**
   * Get environment by name
   */
  getEnvironment(
    config: BCTestConfig,
    name?: string
  ): BCTestEnvironment | undefined {
    const envName = name || config.defaultEnvironment;
    return config.environments.find((e) => e.name === envName);
  }

  /**
   * Get list of environment names
   */
  getEnvironmentNames(config: BCTestConfig): string[] {
    return config.environments.map((e) => e.name);
  }

  /**
   * Show quick pick for environment selection
   */
  async selectEnvironment(config: BCTestConfig): Promise<string | undefined> {
    const items = config.environments.map((env) => ({
      label: env.name,
      description: env.description || `${env.type} - ${env.server}`,
      detail: `Container: ${env.containerName}, Auth: ${env.authentication}`,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: "Select BC Environment",
      placeHolder: "Choose an environment to use",
    });

    return selected?.label;
  }

  /**
   * Show quick pick for config file selection (multi-root)
   */
  async selectConfigFile(): Promise<string | undefined> {
    const configFiles = await this.findAllConfigFiles();

    if (configFiles.length === 0) {
      vscode.window.showWarningMessage(
        "No bctest.config.json files found in workspace"
      );
      return undefined;
    }

    if (configFiles.length === 1) {
      return configFiles[0];
    }

    const items = configFiles.map((file) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(file)
      );
      return {
        label: path.basename(path.dirname(file)),
        description: workspaceFolder?.name || path.dirname(file),
        detail: file,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      title: "Select Configuration",
      placeHolder: "Choose a bctest.config.json file",
    });

    return selected?.detail;
  }

  /**
   * Create a default configuration file
   */
  async createDefaultConfig(targetFolder: string): Promise<string> {
    const defaultConfig = {
      $schema:
        "./node_modules/bc-test-runner/schemas/bctest.config.schema.json",
      workspacePath: "../",
      defaultEnvironment: "docker-local",
      apps: ["App", "TestApp"],
      testApp: {
        path: "TestApp",
        extensionId: "00000000-0000-0000-0000-000000000000",
        extensionName: "My Test App",
        testCodeunitRange: "80000..80099",
      },
      environments: [
        {
          name: "docker-local",
          description: "Local Docker BC container",
          type: "docker",
          containerName: "bcserver",
          server: "http://bcserver",
          serverInstance: "BC",
          authentication: "UserPassword",
          syncMode: "ForceSync",
        },
      ],
      output: {
        resultsFolder: "TestApp/.testresults",
        keepHistoryCount: 10,
        formats: ["json", "xml", "html"],
      },
      compilation: {
        enableCodeCop: true,
        enableAppSourceCop: true,
        enablePerTenantExtensionCop: true,
        enableUICop: true,
      },
    };

    const configPath = path.join(targetFolder, "bctest.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(defaultConfig, null, 4),
      "utf-8"
    );

    // Open the file for editing
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      "Created bctest.config.json - please update the configuration values"
    );

    return configPath;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this._fileWatcher?.dispose();
  }
}
