import Anthropic from '@anthropic-ai/sdk';
import { App, Notice, TFile } from 'obsidian';
import { LLMProvider } from '../interfaces/llm';
import { TavilyService } from './tavily';

export class AnthropicService implements LLMProvider {
    id = 'anthropic';
    name = 'Anthropic';
    private anthropic: Anthropic | null = null;
    private app: App;
    private apiKey: string | null = null;
    private tavilyService: TavilyService;

    constructor(app: App) {
        this.app = app;
        this.tavilyService = new TavilyService(app);
    }

    async initialize() {
        try {
            const keyFile = this.app.vault.getAbstractFileByPath('anthropic_api_key.txt');
            if (keyFile && 'read' in this.app.vault) {
                // @ts-ignore
                const content = await this.app.vault.read(keyFile as any);
                this.apiKey = content.trim();
                this.anthropic = new Anthropic({
                    apiKey: this.apiKey,
                    dangerouslyAllowBrowser: true // Required for Obsidian environment
                });
                console.log('Anthropic API Key loaded.');
            } else {
                console.warn('anthropic_api_key.txt not found.');
                // Don't show notice on init, only when trying to use it
            }

            // Also init Tavily
            await this.tavilyService.initialize();
        } catch (e) {
            console.error('Failed to load Anthropic API key', e);
        }
    }

    async getModels() {
        if (!this.apiKey) await this.initialize();
        if (!this.apiKey) return [];

        // Anthropic doesn't have a public models endpoint like Gemini, so we hardcode popular ones
        return [
            { id: 'claude-opus-4-5-20251101', name: 'Claude 4.5 Opus' },
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet' },
            { id: 'claude-haiku-4-5-20251015', name: 'Claude 4.5 Haiku' },
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
            { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
        ];
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
        if (!this.anthropic) await this.initialize();
        if (!this.anthropic) throw new Error('Anthropic API Key not found. Please create anthropic_api_key.txt in your vault root.');

        const messages: any[] = history.map(msg => ({
            role: msg.role === 'model' ? 'assistant' : 'user',
            content: msg.text
        }));

        // Construct the current user message content
        let content: any[] = [];

        // Web Search Logic
        let searchContext = '';
        if (mode === 'web') {
            if (onToolExecution) onToolExecution('Searching web with Tavily...');
            const searchResult = await this.tavilyService.search(prompt);
            searchContext = `\n\nWeb Search Results:\n${searchResult}\n\n`;
            if (onToolExecution) onToolExecution('Search complete.');
        }

        // Add context if provided (Anthropic handles context best in the system prompt or first user message)
        let finalPrompt = prompt;

        // Combine file context and search context
        let fullContext = '';
        if (context) fullContext += `File Context:\n${context}\n`;
        if (searchContext) fullContext += searchContext;

        if (fullContext && messages.length === 0) {
            finalPrompt = `Context:\n${fullContext}\n\nUser Request: ${prompt}`;
        } else if (fullContext) {
            // If there is history, we append context to the latest message or system prompt
            // Appending to latest message is safer for now
            finalPrompt = `Context:\n${fullContext}\n\nUser Request: ${prompt}`;
        }

        content.push({ type: 'text', text: finalPrompt });

        // Handle attachments
        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
                // Anthropic supports base64 images
                if (att.mimeType.startsWith('image/')) {
                    content.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: att.mimeType as any,
                            data: att.data,
                        }
                    });
                } else {
                    // For PDFs or other files, we might need to extract text or warn
                    // Anthropic recently added PDF support but it might require beta headers
                    // For now, let's append text if possible or warn
                    content.push({ type: 'text', text: `\n[Attachment: ${att.name} (${att.mimeType}) - Content not sent to Claude yet]` });
                }
            }
        }

        messages.push({
            role: 'user',
            content: content
        });

        try {
            const response = await this.anthropic.messages.create({
                model: modelName,
                max_tokens: 4096,
                messages: messages,
                system: "You are a helpful AI assistant integrated into Obsidian." + (mode === 'web' ? " You have access to web search results provided in the context. Use them to answer the user's question." : "")
            });

            if (response.content && response.content.length > 0) {
                const textBlock = response.content.find(b => b.type === 'text');
                if (textBlock && 'text' in textBlock) {
                    return textBlock.text;
                }
            }
            return 'Error: No text response from Claude.';

        } catch (e: any) {
            console.error('Anthropic chat error:', e);
            return `Error: ${e.message}`;
        }
    }
}
