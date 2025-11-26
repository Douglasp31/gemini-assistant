import { App, TFile, TFolder, normalizePath } from 'obsidian';

export class VaultService {
    app: App;

    constructor(app: App) {
        this.app = app;
    }

    async listFiles(directory: string = '/', recursive: boolean = false, limit: number = 100): Promise<string[]> {
        const files: string[] = [];
        const folder = this.app.vault.getAbstractFileByPath(normalizePath(directory));

        if (folder instanceof TFolder) {
            VaultService.collectFiles(folder, files, recursive);
        }

        return files.slice(0, limit);
    }

    private static collectFiles(folder: TFolder, files: string[], recursive: boolean) {
        for (const child of folder.children) {
            if (child instanceof TFile) {
                files.push(child.path);
            } else if (child instanceof TFolder && recursive) {
                VaultService.collectFiles(child, files, recursive);
            }
        }
    }

    async readFile(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (file instanceof TFile) {
            return await this.app.vault.read(file);
        }
        throw new Error(`File not found: ${path}`);
    }

    async saveNote(filename: string, content: string): Promise<string> {
        const normalizedPath = normalizePath(filename);
        let file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
            return `Successfully updated note: ${normalizedPath}`;
        } else {
            // Ensure folders exist
            const folders = normalizedPath.split('/').slice(0, -1).join('/');
            if (folders) {
                try {
                    await this.app.vault.createFolder(folders);
                } catch (e) {
                    // Ignore if folder exists
                }
            }
            await this.app.vault.create(normalizedPath, content);
            return `Successfully created note: ${normalizedPath}`;
        }
    }

    async updateFrontmatter(path: string, key: string, value: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (file instanceof TFile) {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter[key] = value;
            });
            return `Successfully updated frontmatter for ${path}`;
        }
        throw new Error(`File not found: ${path}`);
    }

    async findFilesByName(name: string): Promise<string[]> {
        const files = this.app.vault.getFiles();
        return files
            .filter(f => f.name.toLowerCase().includes(name.toLowerCase()))
            .map(f => f.path);
    }

    async replaceInNote(path: string, target: string, replacement: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (file instanceof TFile) {
            const content = await this.app.vault.read(file);

            let actualTarget = target;
            if (content.includes(target)) {
                actualTarget = target;
            } else if (content.includes(target.replace(/\//g, '%2F'))) {
                actualTarget = target.replace(/\//g, '%2F');
            } else if (content.includes(target.replace(/%2F/g, '/'))) {
                actualTarget = target.replace(/%2F/g, '/');
            } else {
                return `Target string not found in ${path}.`;
            }

            const newContent = content.replace(actualTarget, replacement);
            await this.app.vault.modify(file, newContent);
            return `Successfully replaced content in ${path}`;
        }
        throw new Error(`File not found: ${path}`);
    }

    async deleteNote(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!file) {
            throw new Error(`File not found: ${path}`);
        }

        // Ensure Trash folder exists
        const trashFolder = this.app.vault.getAbstractFileByPath('Trash');
        if (!trashFolder) {
            await this.app.vault.createFolder('Trash');
        }

        const fileName = file.name;
        let newPath = `Trash/${fileName}`;

        // Handle collisions
        if (this.app.vault.getAbstractFileByPath(newPath)) {
            const timestamp = new Date().getTime();
            const ext = fileName.split('.').pop();
            const name = fileName.replace(`.${ext}`, '');
            newPath = `Trash/${name}_${timestamp}.${ext}`;
        }

        await this.app.fileManager.renameFile(file, newPath);
        return `Successfully moved ${path} to ${newPath}`;
    }
}
