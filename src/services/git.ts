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
            // Determine credential helper path
            const fs = require('fs');
            let credentialHelper = 'osxkeychain'; // Default fallback
            const xcodePath = '/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core/git-credential-osxkeychain';
            if (fs.existsSync(xcodePath)) {
                credentialHelper = xcodePath;
            }

            // 1. Add all changes
            await this.runCommand('git', ['add', '.']);

            // 2. Commit (allow empty)
            try {
                await this.runCommand('git', ['commit', '-m', 'Sync from Obsidian']);
            } catch (e) {
                // Ignore empty commit error
            }

            // 3. Pull (no rebase, force absolute credential helper)
            await this.runCommand('git', ['-c', `credential.helper=${credentialHelper}`, 'pull', '--no-rebase']);

            // 4. Push (force absolute credential helper)
            await this.runCommand('git', ['-c', `credential.helper=${credentialHelper}`, 'push']);

            new Notice('Git Sync Complete!');
        } catch (error: any) {
            console.error('Git Sync Failed:', error);
            if (error.message.includes('Device not configured') || error.message.includes('could not read Username')) {
                new Notice('Authentication failed. Please run "git pull" in your terminal to log in.');
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
                // Add path to git-credential-osxkeychain
                env.PATH += ':/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core';
                env.PATH += ':/Library/Developer/CommandLineTools/usr/libexec/git-core';
                env.PATH += ':/usr/libexec/git-core';
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
