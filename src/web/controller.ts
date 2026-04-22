import { type WebSocket as WS, WebSocketServer } from 'ws';
import type { ChatMessage } from '../types.js';

export interface WebUIEvent {
  type: 'init' | 'text' | 'tool_call' | 'tool_result' | 'history' | 'status' | 'stats' | 'abort' | 'command_result' | 'effort' | 'settings' | 'models';
  data: any;
}

class WebUIController {
  private wss: WebSocketServer | null = null;
  private userInputCallback: ((text: string) => void) | null = null;
  private commandCallback: ((text: string) => void) | null = null;
  private abortCallback: (() => void) | null = null;
  private getModelsCallback: ((provider: string) => void) | null = null;

  // State cache for hydration on reconnect
  private currentHistory: ChatMessage[] = [];
  private currentStats: any = null;
  private currentStatus: { status: string; processing: boolean } = { status: 'idle', processing: false };
  private currentEffort: string = 'medium';
  private currentPermissionLevel: string = 'normal';
  private currentSecurityProfile: string = 'standard';
  private currentTheme: string = 'dark';

  setServer(wss: WebSocketServer) {
    this.wss = wss;
    
    // Yeni bir client bağlandığında mevcut durumu gönder (Hydration)
    this.wss.on('connection', (ws: WS) => {
      const initPayload = JSON.stringify({
        type: 'init',
        data: {
          history: this.currentHistory,
          stats: this.currentStats,
          status: this.currentStatus,
          effort: this.currentEffort,
          settings: {
            permissionLevel: this.currentPermissionLevel,
            securityProfile: this.currentSecurityProfile,
            theme: this.currentTheme,
          },
        }
      });
      ws.send(initPayload);
    });
  }

  onUserInput(callback: (text: string) => void) {
    this.userInputCallback = callback;
  }

  handleWebInput(text: string) {
    if (this.userInputCallback) {
      this.userInputCallback(text);
    }
  }

  onWebCommand(callback: (text: string) => void) {
    this.commandCallback = callback;
  }

  handleWebCommand(text: string) {
    if (this.commandCallback) {
      this.commandCallback(text);
    }
  }

  sendCommandResult(output: string) {
    this.broadcast({ type: 'command_result', data: output });
  }

  onWebAbort(callback: () => void) {
    this.abortCallback = callback;
  }

  handleWebAbort() {
    if (this.abortCallback) {
      this.abortCallback();
    }
  }

  onGetModels(callback: (provider: string) => void) {
    this.getModelsCallback = callback;
  }

  handleGetModels(provider: string) {
    if (this.getModelsCallback) {
      this.getModelsCallback(provider);
    }
  }

  sendModels(provider: string, models: string[]) {
    this.broadcast({ type: 'models', data: { provider, models } });
  }

  broadcast(event: WebUIEvent) {
    if (!this.wss) return;
    const payload = JSON.stringify(event);
    this.wss.clients.forEach((client: WS) => {
      if (client.readyState === 1 /* OPEN */) {
        client.send(payload);
      }
    });
  }

  sendText(chunk: string) {
    this.broadcast({ type: 'text', data: chunk });
  }

  sendToolCall(name: string, input: Record<string, unknown>) {
    this.broadcast({ type: 'tool_call', data: { name, input } });
  }

  sendToolResult(name: string, output: string, isError: boolean) {
    this.broadcast({ type: 'tool_result', data: { name, output, isError } });
  }

  sendHistory(messages: ChatMessage[]) {
    this.currentHistory = messages;
    this.broadcast({ type: 'history', data: messages });
  }

  sendStatus(status: string, processing: boolean) {
    this.currentStatus = { status, processing };
    this.broadcast({ type: 'status', data: this.currentStatus });
  }

  sendStats(stats: { messages: number; inputTokens: number; outputTokens: number; turns: number; provider: string; model: string }) {
    this.currentStats = stats;
    this.broadcast({ type: 'stats', data: stats });
  }

  sendEffort(level: string) {
    this.currentEffort = level;
    this.broadcast({ type: 'effort', data: level });
  }

  sendSettings(settings: { permissionLevel: string; securityProfile: string; theme?: string }) {
    this.currentPermissionLevel = settings.permissionLevel;
    this.currentSecurityProfile = settings.securityProfile;
    if (settings.theme) this.currentTheme = settings.theme;
    this.broadcast({ type: 'settings', data: settings });
  }
}

export const webUIController = new WebUIController();
