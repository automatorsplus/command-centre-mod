export type SavedPrompt = { id: string; label: string; prompt: string }
export type CentreTab = 'prompts' | 'skills'

declare module 'claude-code' {
  interface PluginState {
    'command-centre': { prompts: SavedPrompt[]; tab: CentreTab; status: string; page: number }
  }
}
