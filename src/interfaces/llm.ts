export interface LLMProvider {
    id: string;
    name: string;
    initialize(): Promise<void>;
    getModels(): Promise<{ id: string, name: string }[]>;
    chat(
        prompt: string,
        history: { role: 'user' | 'model', text: string }[],
        context: string | null,
        modelName: string,
        mode: 'obsidian' | 'web',
        onToolExecution?: (message: string) => void,
        attachments?: { name: string, data: string, mimeType: string }[],
        onMetadata?: (metadata: any) => void,
        options?: { deepThink?: boolean }
    ): Promise<string>;
}
