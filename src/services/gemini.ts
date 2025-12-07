import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { App, Notice, TFile, MarkdownView } from 'obsidian';
import { VaultService } from './vault';

import { LLMProvider } from '../interfaces/llm';

export class GeminiService implements LLMProvider {
    id = 'gemini';
    name = 'Google Gemini';
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
        onToolExecution?: (message: string) => void,
        attachments: { name: string, data: string, mimeType: string }[] = [],
        onMetadata?: (metadata: any) => void,
        options?: { deepThink?: boolean }
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
                        },
                        {
                            name: 'delete_note',
                            description: 'Safely delete a note by moving it to the Trash folder.',
                            parameters: {
                                type: 'OBJECT',
                                properties: {
                                    path: { type: 'STRING', description: 'The path of the file to delete' }
                                },
                                required: ['path']
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

        const modelConfig: any = {
            model: modelName,
            tools: tools,
            systemInstruction: systemInstruction ? { role: 'system', parts: [{ text: systemInstruction }] } as any : undefined
        };

        if (options && options.deepThink) {
            // Add thinking config for Deep Think
            // According to documentation/User request, they want thinking_level="HIGH"
            // Since SDK types might vary, we pass it as 'thinkingConfig' which is standard for 0.24+
            // Or 'thinking_config' if snake_case is required by underlying REST API layer if SDK doesn't map it.
            // Using 'thinkingConfig' as per latest JS SDK patterns.
            // Note: 'includeThoughts' is usually what enables it. 'thinkingLevel' might be the param name if supported.
            // User specifically asked for 'thinking_level="HIGH"'.
            // I'll try to set it in a way that matches what they likely mean (Thinking mode).
            // Defaulting to includeThoughts: true is the best robust step.
            modelConfig.thinkingConfig = { includeThoughts: true };
            console.log('Gemini: Deep Think enabled (thinkingConfig added)');
        }

        const model = this.genAI.getGenerativeModel(modelConfig);

        // Map history to SDK format
        const chatHistory = history.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.text }]
        }));

        // Add context to the first user message if provided
        if (context && chatHistory.length > 0 && chatHistory[0].role === 'user') {
            chatHistory[0].parts[0].text = `Context:\n${context}\n\nUser Request: ${chatHistory[0].parts[0].text}`;
        }

        const chat = model.startChat({
            history: chatHistory
        });

        let finalPrompt: string | (string | { inlineData: { mimeType: string, data: string } })[] = prompt;

        if (context && chatHistory.length === 0) {
            finalPrompt = `Context:\n${context}\n\nUser Request: ${prompt}`;
        }

        // Handle attachments
        if (attachments && attachments.length > 0) {
            const parts: any[] = [{ text: typeof finalPrompt === 'string' ? finalPrompt : '' }];
            for (const att of attachments) {
                parts.push({
                    inlineData: {
                        mimeType: att.mimeType,
                        data: att.data
                    }
                });
            }
            // If we have attachments, finalPrompt becomes an array of parts
            // But sendMessage expects string | Array<string | Part>
            // We need to be careful. startChat history is text-only usually.
            // Actually, sendMessage can take an array of parts.
            finalPrompt = parts;
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
                    } else if (name === 'delete_note') {
                        toolResult = await this.vaultService.deleteNote(toolArgs.path);
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

        // Extract Usage Metadata
        // @ts-ignore - usageMetadata might not be in the type definition yet
        if (response.usageMetadata && onMetadata) {
            console.log('Gemini usage metadata found:', response.usageMetadata);
            // @ts-ignore
            onMetadata({ usage: response.usageMetadata });
        } else {
            console.log('No usage metadata in response. Full response keys:', Object.keys(response));
            console.log('Full response object:', JSON.stringify(response, null, 2));
            // Try looking for it in case it's nested differently or under a different name
            // @ts-ignore
            if (response.usage_metadata) {
                console.log('Found as usage_metadata (snake_case)');
                // @ts-ignore
                if (onMetadata) onMetadata({ usage: response.usage_metadata });
            }
        }

        try {
            const candidate = response.candidates?.[0];
            if (!candidate || !candidate.content || !candidate.content.parts) {
                throw new Error('No content in response');
            }

            let finalOutput = '';
            let thoughts = '';

            if (candidate.content && candidate.content.parts) {
                console.log('Gemini Response Parts:', JSON.stringify(candidate.content.parts, null, 2));
            }

            for (const part of candidate.content.parts) {
                // @ts-ignore - 'thought' property might not be in generic Part type yet
                if (part.thought) {
                    // @ts-ignore
                    thoughts += part.thought + '\n';
                } else if (part.text) {
                    finalOutput += part.text;
                } else if (part.inlineData) {
                    // Handle inline image data
                    const mimeType = part.inlineData.mimeType;
                    const data = part.inlineData.data;
                    finalOutput += `\n![Generated Image](data:${mimeType};base64,${data})\n`;
                } else if (part.executableCode) {
                    finalOutput += `\n\`\`\`${part.executableCode.language}\n${part.executableCode.code}\n\`\`\`\n`;
                } else if (part.codeExecutionResult) {
                    finalOutput += `\nOutput:\n\`\`\`\n${part.codeExecutionResult.output}\n\`\`\`\n`;
                }
            }

            if (thoughts) {
                finalOutput = `<details class="gemini-thoughts">
<summary>Thinking Process</summary>

${thoughts}

</details>

${finalOutput}`;
            } else if (options?.deepThink) {
                // Feature was enabled but model returned no thoughts
                finalOutput = `${finalOutput}\n\n<div style="font-size: 0.8em; color: var(--text-muted); font-style: italic;">(Note: The "Thinking Process" is not supported by this model. Try 'Gemini 2.0 Flash Thinking' if available.)</div>`;
            }

            if (!finalOutput) {
                throw new Error('No text or image content in response');
            }

            console.log('Final processed response:', finalOutput);
            return finalOutput;

        } catch (e) {
            console.warn('Error processing response content', e);

            // Check for safety blocks or other finish reasons
            if (response.candidates && response.candidates.length > 0) {
                const candidate = response.candidates[0];
                if (candidate.finishReason === 'SAFETY') {
                    return 'Response blocked by safety filters. Please try a different prompt.';
                } else if (candidate.finishReason === 'RECITATION') {
                    return 'Response blocked due to recitation check.';
                } else if (candidate.finishReason === 'OTHER') {
                    return 'Response blocked for unknown reasons (finishReason: OTHER).';
                }
            }

            return 'Error: No response received from the model. It might be blocked or encountered an error.';
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

    async fixSpellingAndGrammar(text: string): Promise<string> {
        return this.transcribeAudio(text, 'text/plain');
    }

    async transcribeAudio(input: string, mimeType: string): Promise<string> {
        if (!this.genAI) await this.initialize();
        if (!this.genAI) throw new Error('API Key not found');

        try {
            const spellingFile = this.app.vault.getAbstractFileByPath('Gemini/Command/Spelling Check.md');
            let specializedVocab = '';
            if (spellingFile instanceof TFile) {
                specializedVocab = await this.app.vault.read(spellingFile);
            }

            const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            let prompt = `You are a helpful assistant acting as a dictation transcriber and editor.
            
Task:
1.  Transcribe the audio provided perfectly.
2.  Fix any obvious spelling, grammar, or punctuation errors in the transcription.
3.  Pay special attention to the following SPECIALIZED VOCABULARY. If you hear something sounding like these words, use the exact spelling provided below:\n\n${specializedVocab}\n
4.  Return ONLY the final corrected text. Do not output any preamble.`;

            if (mimeType === 'text/plain') {
                prompt = `You are a helpful assistant.
Task:
1.  Fix the spelling, grammar, and punctuation of the following text.
2.  Use this SPECIALIZED VOCABULARY as the source of truth:\n\n${specializedVocab}\n
3.  Return ONLY the corrected text.

Input Text:
${input}`;
                const result = await model.generateContent(prompt);
                return result.response.text().trim();
            } else {
                const result = await model.generateContent([
                    prompt,
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: input
                        }
                    }
                ]);
                return result.response.text().trim();
            }

        } catch (error: any) {
            console.error('Gemini Dictation Error:', error);
            new Notice('Gemini Dictation Failed: ' + error.message);
            throw error;
        }
    }
    async syncPlugin() {
        new Notice('Syncing plugin code...');
        const { exec } = require('child_process');

        const sourceDir = '/Users/stephenpearse/Documents/PKM/Obsidian Sync Main/gemini-assistant';

        // Add path to credential helper and common git locations
        const pathFix = 'export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core';

        const commands = [
            pathFix,
            `cd "${sourceDir}"`,
            'git add .',
            '(git commit -m "Sync from Obsidian" || true)',
            'git pull --no-rebase',
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
    insertTextAtCursor(text: string) {
        console.log('Gemini: Attempting to insert text at cursor...');
        let view = this.app.workspace.getActiveViewOfType(MarkdownView);
        console.log('Gemini: Initial getActiveViewOfType result:', view);

        // If focus is on the sidebar (plugin), getActiveViewOfType might return null.
        // Fallback: Find the most recent markdown leaf.
        if (!view) {
            console.log('Gemini: No active view found. Searching leaves...');
            const leaves = this.app.workspace.getLeavesOfType('markdown');
            console.log(`Gemini: Found ${leaves.length} markdown leaves.`);

            // Iterate to find a valid one with an editor
            for (const leaf of leaves) {
                const v = leaf.view as MarkdownView;
                // Check if it's really a MarkdownView and has an editor (Source mode)
                if (v instanceof MarkdownView && v.editor) {
                    console.log('Gemini: Found valid fallback view:', v.file?.path, 'Mode:', v.getMode());
                    view = v;
                    break;
                } else {
                    console.log('Gemini: Skipping invalid view:', v.file?.path, 'Has Editor:', !!v.editor);
                }
            }
        }

        if (view) {
            const editor = view.editor;
            // Ensure editor exists and is ready
            if (editor) {
                console.log('Gemini: Editor found. Replacing selection.');

                // Focus the leaf first to ensure UI updates correctly
                // @ts-ignore
                if (view.leaf) this.app.workspace.setActiveLeaf(view.leaf, { focus: true });

                editor.replaceSelection(text);
                new Notice('Text inserted into document.');
            } else {
                console.error('Gemini: View found but no editor instance.');
                new Notice('Editor not initialized.');
            }
        } else {
            console.error('Gemini: ABSOLUTELY NO MARKDOWN VIEW FOUND.');
            new Notice('Gemini: No active note found to insert text.');
        }
    }
}
