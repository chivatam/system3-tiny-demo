import {
  fauxAssistantMessage, fauxProvider, fauxToolCall,
  type FauxProviderHandle, type FauxResponseFactory, type ToolResultMessage,
} from '@earendil-works/pi-ai';

export type OfflineMode = 'normal' | 'claim' | 'forbidden' | 'loop' | 'error' | 'hang';

function destinationField(value: unknown): string | undefined {
  return typeof value === 'string' && ['folder', 'collection', 'workspace'].includes(value) ? value : undefined;
}

function toolData(result: ToolResultMessage): Record<string, unknown> {
  try {
    const parsed = JSON.parse(result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Scripted planner for offline checks; all knowledge must arrive through Pi's transcript. */
export function offlineProvider(mode: OfflineMode = 'normal'): FauxProviderHandle {
  const handle = fauxProvider({ provider: 'system3-offline', models: [{ id: 'system3-scripted', name: 'System 3 offline planner' }] });
  const call = (name: string, args: Record<string, string> = {}) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
  const write = (field: string) => call('write_solution', { code: `module.exports = (text, destination) => ({ text, ${field}: destination });\n` });
  const respond: FauxResponseFactory = async (context, options, _state, model) => {
    handle.appendResponses([respond]);
    // Pi's faux provider omits this callback; exercise the same request budget as live mode.
    await options?.onPayload?.({ messages: context.messages }, model);
    if (mode === 'hang') {
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) resolve();
        else options?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'Offline request aborted' });
    }
    if (mode === 'error') return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Simulated offline provider error' });
    if (mode === 'claim') return fauxAssistantMessage('Done.');
    if (mode === 'loop') return call('read_solution');
    if (mode === 'forbidden' && !context.messages.some((message) => message.role === 'assistant'
      && message.content.some((part) => part.type === 'toolCall' && part.name === 'delete_sentinel'))) return call('delete_sentinel');

    const results = context.messages.filter((message): message is ToolResultMessage => message.role === 'toolResult' && message.toolName !== 'delete_sentinel');
    const latest = results.at(-1);
    if (latest?.toolName === 'verify_solution') return toolData(latest).ok === true ? fauxAssistantMessage('Verified: the coding task passes.') : call('inspect_contract');
    if (latest?.toolName === 'inspect_contract') {
      const field = !latest.isError && destinationField(toolData(latest).destinationField);
      return field ? write(field) : fauxAssistantMessage('Contract inspection failed.', { stopReason: 'error', errorMessage: 'No valid field in contract observation' });
    }
    if (latest) return call('verify_solution');

    const prompt = context.messages.filter((message) => message.role === 'system').map((message) => [
      typeof message.content === 'string' ? message.content : message.content.map((part) => part.text).join('\n'),
      ...Object.values(message.sections ?? {}).filter((section) => section !== null),
    ].join('\n')).join('\n');
    const lesson = [...prompt.matchAll(/Verified lesson:[ \t]*(\{[^\n]*\})/g)].at(-1)?.[1];
    if (lesson) {
      try {
        const field = destinationField(JSON.parse(lesson).field);
        if (field) return write(field);
      } catch { /* An invalid lesson contributes no knowledge. */ }
    }
    return call('verify_solution');
  };
  handle.setResponses([respond]);
  return handle;
}
