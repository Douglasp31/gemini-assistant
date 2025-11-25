import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { App, Notice, TFile } from 'obsidian';
import { VaultService } from './vault';

export class GeminiService {
    private genAI: GoogleGenerativeAI | null = null;
    private vaultService: VaultService;
    private app: App;
    private apiKey: string | null = null;

    constructor(app: App) {
        this.app = app;
        this.vaultService = new VaultService(app);
    }

    async initialize() {
        try {
            // Try to load API key from vault
            const keyFile = this.app.vault.getAbstractFileByPath('gemini_api_key.txt');
            if (keyFile && 'read' in this.app.vault) {
                // @ts-ignore - we know it's a TFile if it was found, but need to cast or check
                const content = await this.app.vault.read(keyFile as any);
                this.apiKey = content.trim();
                this.genAI = new GoogleGenerativeAI(this.apiKey);
                console.log('Gemini API Key loaded.');
            } else {
                console.warn('gemini_api_key.txt not found.');
                new Notice('Gemini Assistant: Please create gemini_api_key.txt in your vault root.');
            }
        } catch (e) {
            console.error('Failed to load API key', e);
        }
    }

    async getModels() {
        if (!this.apiKey) await this.initialize();
        if (!this.apiKey) return [];

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }
            const data = await response.json();

            return (data.models || [])
                .filter((m: any) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                .map((m: any) => ({
                    id: m.name.replace('models/', ''),
                    name: m.displayName || m.name
                }))
                .sort((a: any, b: any) => b.name.localeCompare(a.name));
        } catch (e) {
            console.error('Error fetching models:', e);
            // Fallback
            return [
                { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
            ];
        }
    }

    async chat(
        prompt: string,
        history: { role: 'user' | 'model', text: string }[],
        context: string | null,
        modelName: string,
        mode: 'obsidian' | 'web',
        onToolExecution?: (message: string) => void
    ): Promise<string> {
        if (!this.genAI) await this.initialize();
        if (!this.genAI) throw new Error('API Key not found');

        let tools: any[] = [];
        let systemInstruction = '';

        if (mode === 'obsidian') {
            // Try to load ANTIGRAVITY.md
            try {
                const antigravityFile = this.app.vault.getAbstractFileByPath('ANTIGRAVITY.md');
                if (antigravityFile instanceof TFile) {
                    systemInstruction = await this.app.vault.read(antigravityFile);
                    console.log('Loaded system instructions from ANTIGRAVITY.md');
                } else {
                    systemInstruction = 'You are a helpful AI assistant integrated into Obsidian. You can read and modify notes in the vault.';
                }
            } catch (e) {
                console.warn('Failed to load ANTIGRAVITY.md', e);
                systemInstruction = 'You are a helpful AI assistant integrated into Obsidian. You can read and modify notes in the vault.';
            }

            tools = [
                {
                    functionDeclarations: [
                        {
                            name: 'list_files',
                            description: 'List files in the vault.',
                            parameters: {
                                type: 'OBJECT',
                                properties: {
                                    directory: { type: 'STRING' },
                                    recursive: { type: 'BOOLEAN' },
                                    limit: { type: 'NUMBER' }
                                }
                            }
                        },
                        {
                            name: 'read_note',
                            description: 'Read the content of a note.',
                            parameters: {
                                type: 'OBJECT',
                                properties: { filename: { type: 'STRING' } },
                                required: ['filename']
                            }
                        },
                        {
                            name: 'save_note',
                            description: 'Save or overwrite a note.',
                            parameters: {
                                type: 'OBJECT',
                                properties: {
                                    filename: { type: 'STRING' },
                                    content: { type: 'STRING' }
                                },
                                required: ['filename', 'content']
                            }
                        },
                        {
                            name: 'update_frontmatter',
                            description: 'Update frontmatter property.',
                            parameters: {
                                type: 'OBJECT',
                                properties: {
                                    path: { type: 'STRING' },
                                    key: { type: 'STRING' },
                                    value: { type: 'STRING' }
                                },
                                required: ['path', 'key', 'value']
                            }
                        },
                        {
                            name: 'find_files_by_name',
                            description: 'Find files by name (fuzzy match). Returns the FULL PATH of matching files. Use this FULL PATH when fixing links.',
                            parameters: {
                                type: 'OBJECT',
                                properties: {
                                    name: { type: 'STRING' }
                                },
                                required: ['name']
                            }
                        },
                        {
                            name: 'replace_in_note',
                            description: 'Replace a specific string in a note with a new string. When fixing links, replace the old link with a Wikilink containing the FULL PATH (e.g., "![[Path/To/File.png]]").',
                            parameters: {
                                type: 'OBJECT',
                                properties: {
                                    path: { type: 'STRING' },
                                    target: { type: 'STRING' },
                                    replacement: { type: 'STRING' }
                                },
                                required: ['path', 'target', 'replacement']
                            }
                        }
                    ]
                }
            ];
        } else {
            // Web Mode
            tools = [{ googleSearch: {} }];
            systemInstruction = 'You are a helpful AI assistant with access to Google Search. Use it to provide up-to-date information. Always cite your sources.';
        }

        const model = this.genAI.getGenerativeModel({
            model: modelName,
            tools: tools,
            systemInstruction: systemInstruction ? { role: 'system', parts: [{ text: systemInstruction }] } as any : undefined
        });

        // Map history to SDK format
        const chatHistory = history.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.text }]
        }));

        // Add context to the first user message if provided
        if (context && chatHistory.length > 0 && chatHistory[0].role === 'user') {
            chatHistory[0].parts[0].text = `Context:\n${context}\n\nUser Request: ${chatHistory[0].parts[0].text}`;
        } else if (context) {
            // If no history, prepend context to the new prompt (handled below in sendMessage)
            // Actually, startChat takes history. If history is empty, we just send prompt.
            // If history exists, we use it.
        }

        const chat = model.startChat({
            history: chatHistory
        });

        let finalPrompt = prompt;
        if (context && chatHistory.length === 0) {
            finalPrompt = `Context:\n${context}\n\nUser Request: ${prompt}`;
        }

        let result = await chat.sendMessage(finalPrompt);
        let response = await result.response;
        // @ts-ignore - SDK types might be outdated or mismatch
        let functionCalls = (response.functionCalls && response.functionCalls()) || [];

        console.log('Initial response:', response);
        if (functionCalls && functionCalls.length > 0) console.log('Function calls detected:', functionCalls);

        let turns = 0;
        const MAX_TURNS = 5;

        while (functionCalls && functionCalls.length > 0 && turns < MAX_TURNS) {
            turns++;
            console.log(`Turn ${turns}: Processing ${functionCalls.length} function calls`);
            const functionResponses = [];

            for (const call of functionCalls) {
                const { name, args } = call;
                if (onToolExecution) onToolExecution(`Executing ${name}...`);
                console.log(`Executing tool: ${name}`, args);

                let toolResult;
                const toolArgs = args as any; // Cast to any to avoid type errors

                try {
                    if (name === 'list_files') {
                        toolResult = await this.vaultService.listFiles(toolArgs.directory, toolArgs.recursive, toolArgs.limit);
                    } else if (name === 'read_note') {
                        toolResult = await this.vaultService.readFile(toolArgs.filename);
                    } else if (name === 'save_note') {
                        toolResult = await this.vaultService.saveNote(toolArgs.filename, toolArgs.content);
                    } else if (name === 'update_frontmatter') {
                        toolResult = await this.vaultService.updateFrontmatter(toolArgs.path, toolArgs.key, toolArgs.value);
                    } else if (name === 'find_files_by_name') {
                        const files = await this.vaultService.findFilesByName(toolArgs.name);
                        toolResult = files.length > 0 ? files.join('\n') : 'No files found.';
                    } else if (name === 'replace_in_note') {
                        toolResult = await this.vaultService.replaceInNote(toolArgs.path, toolArgs.target, toolArgs.replacement);
                    } else {
                        toolResult = `Unknown tool: ${name}`;
                    }
                } catch (e: any) {
                    console.error(`Tool execution error (${name}):`, e);
                    toolResult = `Error: ${e.message}`;
                }

                console.log(`Tool result for ${name}:`, toolResult);

                functionResponses.push({
                    functionResponse: {
                        name: name,
                        response: { result: toolResult }
                    }
                });
            }

            // @ts-ignore - sending function responses back
            result = await chat.sendMessage(functionResponses);
            response = await result.response;
            // @ts-ignore
            functionCalls = (response.functionCalls && response.functionCalls()) || [];
        }

        try {
            const text = response.text();
            console.log('Final text response:', text);
            return text;
        } catch (e) {
            console.warn('No text in final response', e);
            return '';
        }
    }

    async getCustomCommands(): Promise<{ label: string, prompt: string }[]> {
        try {
            const antigravityFile = this.app.vault.getAbstractFileByPath('ANTIGRAVITY.md');
            if (antigravityFile instanceof TFile) {
                const content = await this.app.vault.read(antigravityFile);
                const match = content.match(/## Custom Commands\n([\s\S]*?)(?=$|^#)/);
                if (match && match[1]) {
                    return match[1].split('\n')
                        .map(line => line.trim())
                        .filter(line => line.startsWith('-'))
                        .map(line => {
                            const parts = line.substring(1).split(':');
                            if (parts.length >= 2) {
                                return {
                                    label: parts[0].trim(),
                                    prompt: parts.slice(1).join(':').trim()
                                };
                            }
                            return null;
                        })
                        .filter((cmd): cmd is { label: string, prompt: string } => cmd !== null);
                }
            }
        } catch (e) {
            console.warn('Failed to load custom commands', e);
        }
        return [];
    }

    async getGems(): Promise<{ name: string, path: string }[]> {
        try {
            const files = await this.vaultService.listFiles('Gemini Gems');
            return files.map(path => ({
                name: path.split('/').pop()?.replace('.md', '') || path,
                path: path
            }));
        } catch (e) {
            console.warn('Failed to load Gems', e);
            return [];
        }
    }

    async readGem(path: string): Promise<string> {
        return await this.vaultService.readFile(path);
    }

    async syncPlugin() {
        new Notice('Syncing plugin code...');
        const { exec } = require('child_process');
        const pluginDir = (this.app.vault.adapter as any).basePath + '/.obsidian/plugins/gemini-assistant';

        // We need to sync the DEVELOPMENT directory, not the installed one, usually.
        // But the user asked to "Sync Plugin Code".
        // Assuming the user wants to sync the repo where the code lives.
        // Based on previous context, the user is working in "/Users/stephenpearse/Documents/PKM/Obsidian Sync Main/gemini-assistant"
        // But the plugin runs from .obsidian/plugins/gemini-assistant.
        // If the user wants to sync the *source* code, we should target the source directory.
        // However, from within the plugin, we might not know where the source is if it's separate.
        // Given the user's setup [URI] -> [CorpusName]: /Users/stephenpearse/Documents/PKM/Obsidian Sync Main/gemini-assistant -> Douglasp31/gemini-assistant
        // It seems the source IS the vault or a folder in it?
        // Wait, the CWD for my tools has been "/Users/stephenpearse/Documents/PKM/Obsidian Sync Main/gemini-assistant".
        // So I should try to sync THAT directory.

        const sourceDir = '/Users/stephenpearse/Documents/PKM/Obsidian Sync Main/gemini-assistant';

        const commands = [
            `cd "${sourceDir}"`,
            'git add .',
            '(git commit -m "Sync from Obsidian" || true)',
            'git pull',
            'git push'
        ].join(' && ');

        exec(commands, (error: any, stdout: any, stderr: any) => {
            if (error) {
                console.error(`exec error: ${error}`);
                new Notice(`Sync failed: ${error.message}`);
                return;
            }
            console.log(`stdout: ${stdout}`);
            console.error(`stderr: ${stderr}`);
            new Notice('Plugin code synced successfully!');
        });
    }
}
