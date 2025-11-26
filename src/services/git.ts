import { exec } from 'child_process';
import { Notice } from 'obsidian';

export class GitService {
    private pluginPath: string;

    constructor(pluginPath: string) {
        this.pluginPath = pluginPath;
    }

    async sync(): Promise<void> {
        new Notice('Starting Git Sync...');

        try {
<<<<<<< HEAD
            // 1. Check for local changes and Commit them FIRST
            const status = await this.runCommand('git', ['status', '--porcelain']);

            if (status.trim()) {
                await this.runCommand('git', ['add', '.']);
                await this.runCommand('git', ['commit', '-m', 'Auto-sync from Obsidian']);
                new Notice('Local changes committed.');
            }

            // 2. Pull remote changes (will merge if necessary)
            // Use --no-rebase to force a merge commit if branches have diverged
            await this.runCommand('git', ['pull', 'origin', 'main', '--no-rebase']);
            new Notice('Git Pull Complete');

            // 3. Push everything (local commits + merged changes)
=======
            // 1. Pull first to avoid conflicts
            try {
                await this.runCommand('git', ['pull', 'origin', 'main']);
                new Notice('Git Pull Complete');
            } catch (e) {
                console.warn('Pull failed (might be offline or conflict), continuing...', e);
            }

            // 2. Add and Commit any changes
            const status = await this.runCommand('git', ['status', '--porcelain']);
            if (status.trim()) {
                await this.runCommand('git', ['add', '.']);
                try {
                    await this.runCommand('git', ['commit', '-m', 'Auto-sync from Obsidian']);
                    new Notice('Committed changes.');
                } catch (e) {
                    // Should not happen if status was not empty, but safety first
                    console.warn('Commit failed', e);
                }
            }

            // 3. Push (Always try to push to ensure local commits go up)
>>>>>>> 26a3edf3177a3ff86088cace6fc4d276f8f39ece
            await this.runCommand('git', ['push', 'origin', 'main']);
            new Notice('Git Push Complete: Code synced to GitHub');

        } catch (error: any) {
            console.error('Git Sync Failed:', error);
            // Check for specific "Device not configured" error to give helpful hint
            if (error.message.includes('Device not configured')) {
                new Notice('Git Sync Failed: Auth error. Please ensure git-credential-osxkeychain is configured.');
            } else {
                new Notice(`Git Sync Failed: ${error.message}`);
            }
        }
    }

    private async runCommand(cmd: string, args: string[]): Promise<string> {
        const { spawn } = require('child_process');
        const fs = require('fs');

        return new Promise((resolve, reject) => {
            // Determine absolute path to git
            let commandToRun = cmd;
            if (cmd === 'git') {
                const possiblePaths = [
                    '/usr/bin/git',
                    '/usr/local/bin/git',
                    '/opt/homebrew/bin/git',
                    '/bin/git'
                ];
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        commandToRun = p;
                        break;
                    }
                }
            }

            console.log(`[GitService] Spawning: ${commandToRun} with args: ${args.join(' ')} in ${this.pluginPath}`);

            // Fix PATH for Mac apps
            const env = Object.assign({}, process.env);

            if (process.platform === 'darwin') {
                env.PATH = `${env.PATH}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
            }

            const child = spawn(commandToRun, args, {
                cwd: this.pluginPath,
                env: env,
                shell: false
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: any) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data: any) => {
                stderr += data.toString();
            });

            child.on('error', (error: any) => {
                console.error(`[GitService] Spawn Error: ${error.message}`);
                reject(error);
            });

            child.on('close', (code: number) => {
                if (code !== 0) {
                    console.error(`[GitService] Process exited with code ${code}`);
                    console.error(`[GitService] Stderr: ${stderr}`);
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                } else {
                    console.log(`[GitService] Stdout: ${stdout}`);
                    resolve(stdout);
                }
            });
        });
    }
}
