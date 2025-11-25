import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { AIChat } from './src/components/AIChat';
import { GeminiService } from './src/services/gemini';

const VIEW_TYPE_GEMINI = "gemini-view";

export default class GeminiPlugin extends Plugin {
    private geminiService: GeminiService;

    async onload() {
        console.log('Loading Gemini Assistant Plugin');
        new Notice('Gemini Plugin v1.0.14 Loaded');

        this.geminiService = new GeminiService(this.app);

        this.registerView(
            VIEW_TYPE_GEMINI,
            (leaf) => new GeminiView(leaf, this.geminiService)
        );

        this.addRibbonIcon('bot', 'Open Gemini Assistant', () => {
            this.activateView();
        });
    }

    async onunload() {
        console.log('Unloading Gemini Assistant Plugin');
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_GEMINI);

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for it
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_GEMINI, active: true });
        }

        // "Reveal" the leaf in case it is in a collapsed sidebar
        workspace.revealLeaf(leaf);
    }
}

class GeminiView extends ItemView {
    root: ReactDOM.Root | null = null;
    geminiService: GeminiService;

    constructor(leaf: WorkspaceLeaf, geminiService: GeminiService) {
        super(leaf);
        this.geminiService = geminiService;
    }

    getViewType() {
        return VIEW_TYPE_GEMINI;
    }

    getDisplayText() {
        return "Gemini Assistant";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        const reactContainer = container.createDiv();
        reactContainer.addClass('gemini-assistant-container');

        this.root = ReactDOM.createRoot(reactContainer);
        this.root.render(
            React.createElement(AIChat, {
                geminiService: this.geminiService,
                getActiveFileContent: async () => {
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile) {
                        const content = await this.app.vault.read(activeFile);
                        return `Active File Context (${activeFile.path}):\n\n${content}`;
                    }
                    return null;
                }
            })
        );
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
        }
    }
}
