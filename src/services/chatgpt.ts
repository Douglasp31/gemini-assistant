import OpenAI from 'openai';
import { App, Notice } from 'obsidian';
import { LLMProvider } from '../interfaces/llm';
import { TavilyService } from './tavily';

export class ChatGPTService implements LLMProvider {
    id = 'chatgpt';
    name = 'ChatGPT';
    private openai: OpenAI | null = null;
    private app: App;
    private apiKey: string | null = null;
    private tavilyService: TavilyService;

    constructor(app: App) {
        this.app = app;
        this.tavilyService = new TavilyService(app);
    }

    async initialize() {
        try {
            const keyFile = this.app.vault.getAbstractFileByPath('chatgpt_api_key.txt');
            if (keyFile && 'read' in this.app.vault) {
                // @ts-ignore
                const content = await this.app.vault.read(keyFile as any);
                this.apiKey = content.trim();
                this.openai = new OpenAI({
                    apiKey: this.apiKey,
                    dangerouslyAllowBrowser: true // Required for Obsidian environment
                });
                console.log('ChatGPT API Key loaded.');
            } else {
                console.warn('chatgpt_api_key.txt not found.');
            }

            // Also init Tavily for web search
            await this.tavilyService.initialize();
        } catch (e) {
            console.error('Failed to load ChatGPT API key', e);
        }
    }

    async getModels() {
        // Always attempt initialization but return models regardless
        // This allows users to see available models before configuring their key
        if (!this.apiKey) await this.initialize();

        // OpenAI models - latest first
        return [
            { id: 'gpt-4.1', name: 'GPT-4.1' },
            { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
            { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
            { id: 'o4-mini', name: 'o4 Mini' },
            { id: 'o3', name: 'o3' },
            { id: 'o3-mini', name: 'o3 Mini' },
            { id: 'o1', name: 'o1' },
            { id: 'o1-mini', name: 'o1 Mini' },
            { id: 'o1-pro', name: 'o1 Pro' }
        ];
    }

    async chat(
        prompt: string,
        history: { role: 'user' | 'model', text: string }[],
        context: string | null,
        modelName: string,
        mode: 'obsidian' | 'web',
        onToolExecution?: (message: string) => void,
        attachments: { name: string, data: string, mimeType: string }[] = []
    ): Promise<string> {
        if (!this.openai) await this.initialize();
        if (!this.openai) throw new Error('ChatGPT API Key not found. Please create chatgpt_api_key.txt in your vault root.');

        // Convert history to OpenAI format
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = history.map(msg => ({
            role: msg.role === 'model' ? 'assistant' as const : 'user' as const,
            content: msg.text
        }));

        // Web Search Logic
        let searchContext = '';
        if (mode === 'web') {
            if (onToolExecution) onToolExecution('Searching web with Tavily...');
            const searchResult = await this.tavilyService.search(prompt);
            searchContext = `\n\nWeb Search Results:\n${searchResult}\n\n`;
            if (onToolExecution) onToolExecution('Search complete.');
        }

        // Add context if provided
        let finalPrompt = prompt;

        // Combine file context and search context
        let fullContext = '';
        if (context) fullContext += `File Context:\n${context}\n`;
        if (searchContext) fullContext += searchContext;

        if (fullContext && messages.length === 0) {
            finalPrompt = `Context:\n${fullContext}\n\nUser Request: ${prompt}`;
        } else if (fullContext) {
            finalPrompt = `Context:\n${fullContext}\n\nUser Request: ${prompt}`;
        }

        // Construct the current user message content
        let content: OpenAI.Chat.ChatCompletionContentPart[] = [];
        content.push({ type: 'text', text: finalPrompt });

        // Handle attachments (images for vision models)
        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
                if (att.mimeType.startsWith('image/')) {
                    content.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${att.mimeType};base64,${att.data}`,
                        }
                    });
                } else {
                    // For PDFs or other files, append as text note
                    content.push({ type: 'text', text: `\n[Attachment: ${att.name} (${att.mimeType}) - Content not sent to ChatGPT yet]` });
                }
            }
        }

        messages.push({
            role: 'user',
            content: content
        });

        // Check if this is a reasoning model (o1, o3, o4 - they have different requirements)
        const isReasoningModel = modelName.startsWith('o1') || modelName.startsWith('o3') || modelName.startsWith('o4');

        try {
            const response = await this.openai.chat.completions.create({
                model: modelName,
                messages: isReasoningModel ? messages : [
                    {
                        role: 'system',
                        content: "You are a helpful AI assistant integrated into Obsidian." +
                            (mode === 'web' ? " You have access to web search results provided in the context. Use them to answer the user's question." : "")
                    },
                    ...messages
                ],
                max_completion_tokens: isReasoningModel ? 16384 : undefined,
                max_tokens: isReasoningModel ? undefined : 4096,
            });

            if (response.choices && response.choices.length > 0) {
                const message = response.choices[0].message;
                if (message && message.content) {
                    return message.content;
                }
            }
            return 'Error: No text response from ChatGPT.';

        } catch (e: any) {
            console.error('ChatGPT chat error:', e);
            return `Error: ${e.message}`;
        }
    }
}
