/**
 * BC Test Runner - Environments Tree View
 *
 * Displays configured environments and their credential status.
 */

import * as vscode from "vscode";
import { ConfigManager } from "../config/ConfigManager";
import { CredentialManager } from "../credentials/CredentialManager";
import { BCTestEnvironment } from "../powershell/PowerShellRunner";

/**
 * Tree item for environments
 */
export class EnvironmentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly environment: BCTestEnvironment,
    public readonly hasCredentials: boolean,
    public readonly isDefault: boolean
  ) {
    super(environment.name, vscode.TreeItemCollapsibleState.None);
    this._setupItem();
  }

  private _setupItem(): void {
    // Set icon based on credential status
    if (this.environment.authentication === "Windows") {
      this.iconPath = new vscode.ThemeIcon("shield");
      this.description = "Windows Auth";
    } else if (this.hasCredentials) {
      this.iconPath = new vscode.ThemeIcon(
        "key",
        new vscode.ThemeColor("charts.green")
      );
      this.description = "Credentials saved";
    } else {
      this.iconPath = new vscode.ThemeIcon(
        "unlock",
        new vscode.ThemeColor("charts.yellow")
      );
      this.description = "No credentials";
    }

    // Mark default environment
    if (this.isDefault) {
      this.label = `★ ${this.environment.name}`;
    }

    // Tooltip with details
    this.tooltip = new vscode.MarkdownString();
    this.tooltip.appendMarkdown(`**${this.environment.name}**\n\n`);
    if (this.environment.description) {
      this.tooltip.appendMarkdown(`${this.environment.description}\n\n`);
    }
    this.tooltip.appendMarkdown(`- **Type:** ${this.environment.type}\n`);
    this.tooltip.appendMarkdown(
      `- **Container:** ${this.environment.containerName}\n`
    );
    this.tooltip.appendMarkdown(`- **Server:** ${this.environment.server}\n`);
    this.tooltip.appendMarkdown(
      `- **Instance:** ${this.environment.serverInstance}\n`
    );
    this.tooltip.appendMarkdown(
      `- **Auth:** ${this.environment.authentication}\n`
    );

    // Context value for commands
    this.contextValue = this.hasCredentials
      ? "environmentWithCreds"
      : "environmentNoCreds";

    // Command to set credentials on click
    if (this.environment.authentication !== "Windows") {
      this.command = {
        command: "bcTestRunner.setCredentialsForEnvironment",
        title: "Set Credentials",
        arguments: [this.environment.name],
      };
    }
  }
}

/**
 * Tree data provider for environments
 */
export class EnvironmentsTreeDataProvider
  implements vscode.TreeDataProvider<EnvironmentTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    EnvironmentTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private _configManager: ConfigManager,
    private _credentialManager: CredentialManager
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: EnvironmentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(
    _element?: EnvironmentTreeItem
  ): Promise<EnvironmentTreeItem[]> {
    try {
      const configPath = await this._configManager.findConfigFile();
      if (!configPath) {
        return [];
      }

      const config = await this._configManager.loadConfig(configPath);
      const items: EnvironmentTreeItem[] = [];

      for (const env of config.environments) {
        const hasCredentials = await this._credentialManager.hasCredential(
          env.name
        );
        const isDefault = env.name === config.defaultEnvironment;
        items.push(new EnvironmentTreeItem(env, hasCredentials, isDefault));
      }

      return items;
    } catch {
      return [];
    }
  }
}
