/**
 * BC Test Runner - Credential Manager
 *
 * Secure credential storage using VSCode's SecretStorage API.
 * Credentials are stored per environment name and persist across sessions.
 */

import * as vscode from "vscode";

/**
 * Stored credential structure
 */
export interface StoredCredential {
  username: string;
  password: string;
  storedAt: string;
}

/**
 * Credential manager for BC Test Runner
 * Uses VSCode's SecretStorage API for secure persistence
 */
export class CredentialManager {
  private static readonly KEY_PREFIX = "bcTestRunner.credential.";
  private _secretStorage: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this._secretStorage = context.secrets;
  }

  /**
   * Get the storage key for an environment
   */
  private _getKey(environmentName: string): string {
    return `${CredentialManager.KEY_PREFIX}${environmentName}`;
  }

  /**
   * Store credentials for an environment
   */
  async storeCredential(
    environmentName: string,
    username: string,
    password: string
  ): Promise<void> {
    const credential: StoredCredential = {
      username,
      password,
      storedAt: new Date().toISOString(),
    };

    const key = this._getKey(environmentName);
    await this._secretStorage.store(key, JSON.stringify(credential));
  }

  /**
   * Get stored credentials for an environment
   * Returns undefined if no credentials are stored
   */
  async getCredential(
    environmentName: string
  ): Promise<StoredCredential | undefined> {
    const key = this._getKey(environmentName);
    const stored = await this._secretStorage.get(key);

    if (!stored) {
      return undefined;
    }

    try {
      return JSON.parse(stored) as StoredCredential;
    } catch {
      // Invalid stored data, clear it
      await this.deleteCredential(environmentName);
      return undefined;
    }
  }

  /**
   * Check if credentials exist for an environment
   */
  async hasCredential(environmentName: string): Promise<boolean> {
    const credential = await this.getCredential(environmentName);
    return credential !== undefined;
  }

  /**
   * Delete stored credentials for an environment
   */
  async deleteCredential(environmentName: string): Promise<void> {
    const key = this._getKey(environmentName);
    await this._secretStorage.delete(key);
  }

  /**
   * Delete all stored credentials
   */
  async deleteAllCredentials(environmentNames: string[]): Promise<void> {
    for (const name of environmentNames) {
      await this.deleteCredential(name);
    }
  }

  /**
   * Prompt user for credentials and optionally store them
   * Returns undefined if user cancels
   */
  async promptForCredentials(
    environmentName: string,
    options?: {
      /** Whether to offer to save credentials */
      offerToSave?: boolean;
      /** Pre-fill username */
      defaultUsername?: string;
    }
  ): Promise<{ username: string; password: string } | undefined> {
    // Prompt for username
    const username = await vscode.window.showInputBox({
      title: `BC Test Runner - Credentials for ${environmentName}`,
      prompt: "Enter username",
      value: options?.defaultUsername,
      placeHolder: "admin",
      ignoreFocusOut: true,
    });

    if (!username) {
      return undefined;
    }

    // Prompt for password
    const password = await vscode.window.showInputBox({
      title: `BC Test Runner - Credentials for ${environmentName}`,
      prompt: "Enter password",
      password: true,
      ignoreFocusOut: true,
    });

    if (!password) {
      return undefined;
    }

    // Ask if user wants to save credentials
    if (options?.offerToSave !== false) {
      const save = await vscode.window.showQuickPick(
        [
          {
            label: "$(key) Save credentials securely",
            value: true,
            description: "Store in VSCode secure storage",
          },
          {
            label: "$(unlock) Use once",
            value: false,
            description: "Do not save",
          },
        ],
        {
          title: "Save credentials?",
          placeHolder: "Choose whether to save credentials for future use",
        }
      );

      if (save?.value) {
        await this.storeCredential(environmentName, username, password);
        vscode.window.showInformationMessage(
          `Credentials saved for environment: ${environmentName}`
        );
      }
    }

    return { username, password };
  }

  /**
   * Get or prompt for credentials
   * First checks stored credentials, prompts if not found
   */
  async getOrPromptCredentials(
    environmentName: string,
    options?: {
      /** Force prompt even if credentials exist */
      forcePrompt?: boolean;
      /** Whether to offer to save new credentials */
      offerToSave?: boolean;
    }
  ): Promise<{ username: string; password: string } | undefined> {
    // Check for stored credentials unless force prompt
    if (!options?.forcePrompt) {
      const stored = await this.getCredential(environmentName);
      if (stored) {
        return {
          username: stored.username,
          password: stored.password,
        };
      }
    }

    // Prompt for credentials
    return this.promptForCredentials(environmentName, {
      offerToSave: options?.offerToSave,
    });
  }

  /**
   * Update password for existing credentials
   */
  async updatePassword(environmentName: string): Promise<boolean> {
    const existing = await this.getCredential(environmentName);
    if (!existing) {
      vscode.window.showWarningMessage(
        `No credentials found for environment: ${environmentName}`
      );
      return false;
    }

    const password = await vscode.window.showInputBox({
      title: `Update password for ${environmentName}`,
      prompt: `Enter new password for user: ${existing.username}`,
      password: true,
      ignoreFocusOut: true,
    });

    if (!password) {
      return false;
    }

    await this.storeCredential(environmentName, existing.username, password);
    vscode.window.showInformationMessage(
      `Password updated for environment: ${environmentName}`
    );
    return true;
  }

  /**
   * List all environments with stored credentials
   * Note: This requires knowing the environment names from config
   */
  async listStoredEnvironments(knownEnvironments: string[]): Promise<string[]> {
    const stored: string[] = [];
    for (const name of knownEnvironments) {
      if (await this.hasCredential(name)) {
        stored.push(name);
      }
    }
    return stored;
  }

  /**
   * Show credential management quick pick
   */
  async showCredentialManager(environmentNames: string[]): Promise<void> {
    const storedEnvs = await this.listStoredEnvironments(environmentNames);

    const items: (vscode.QuickPickItem & { action: string; env?: string })[] = [
      {
        label: "$(add) Add new credentials",
        description: "Store credentials for an environment",
        action: "add",
      },
    ];

    // Add entries for stored credentials
    for (const env of storedEnvs) {
      const cred = await this.getCredential(env);
      items.push({
        label: `$(key) ${env}`,
        description: `User: ${cred?.username} (stored ${
          cred?.storedAt
            ? new Date(cred.storedAt).toLocaleDateString()
            : "unknown"
        })`,
        action: "manage",
        env,
      });
    }

    // Add entries for environments without credentials
    for (const env of environmentNames) {
      if (!storedEnvs.includes(env)) {
        items.push({
          label: `$(unlock) ${env}`,
          description: "No credentials stored",
          action: "add-specific",
          env,
        });
      }
    }

    if (storedEnvs.length > 0) {
      items.push({
        label: "$(trash) Clear all credentials",
        description: "Remove all stored credentials",
        action: "clear-all",
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: "BC Test Runner - Credential Manager",
      placeHolder: "Select an action",
    });

    if (!selected) {
      return;
    }

    switch (selected.action) {
      case "add": {
        // Let user pick environment
        const envPick = await vscode.window.showQuickPick(
          environmentNames.map((e) => ({ label: e })),
          {
            title: "Select environment",
            placeHolder: "Choose environment to add credentials for",
          }
        );
        if (envPick) {
          await this.promptForCredentials(envPick.label);
        }
        break;
      }
      case "add-specific": {
        if (selected.env) {
          await this.promptForCredentials(selected.env);
        }
        break;
      }
      case "manage": {
        if (selected.env) {
          await this._showEnvironmentCredentialOptions(selected.env);
        }
        break;
      }
      case "clear-all": {
        const confirm = await vscode.window.showWarningMessage(
          "Are you sure you want to delete all stored credentials?",
          { modal: true },
          "Delete All"
        );
        if (confirm === "Delete All") {
          await this.deleteAllCredentials(storedEnvs);
          vscode.window.showInformationMessage("All credentials deleted");
        }
        break;
      }
    }
  }

  /**
   * Show options for managing a specific environment's credentials
   */
  private async _showEnvironmentCredentialOptions(
    environmentName: string
  ): Promise<void> {
    const items: (vscode.QuickPickItem & { action: string })[] = [
      {
        label: "$(edit) Update password",
        description: "Change the stored password",
        action: "update",
      },
      {
        label: "$(refresh) Re-enter credentials",
        description: "Enter new username and password",
        action: "reenter",
      },
      {
        label: "$(trash) Delete credentials",
        description: "Remove stored credentials for this environment",
        action: "delete",
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: `Credentials for ${environmentName}`,
      placeHolder: "Select an action",
    });

    if (!selected) {
      return;
    }

    switch (selected.action) {
      case "update":
        await this.updatePassword(environmentName);
        break;
      case "reenter":
        await this.deleteCredential(environmentName);
        await this.promptForCredentials(environmentName);
        break;
      case "delete": {
        const confirm = await vscode.window.showWarningMessage(
          `Delete credentials for ${environmentName}?`,
          { modal: true },
          "Delete"
        );
        if (confirm === "Delete") {
          await this.deleteCredential(environmentName);
          vscode.window.showInformationMessage(
            `Credentials deleted for: ${environmentName}`
          );
        }
        break;
      }
    }
  }
}
