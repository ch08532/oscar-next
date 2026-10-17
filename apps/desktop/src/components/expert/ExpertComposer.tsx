interface Props {
  message: string; maxLength: number; conversationActive: boolean;
  busy: boolean; starting: boolean; ready: boolean;
  onMessageChange(message: string): void; onSend(message: string): void;
  onStop(): void;
}

export function ExpertComposer(props: Props) {
  const { message, busy, starting, ready, conversationActive } = props;
  const canSend = ready && !busy && !starting && !!message.trim();
  return <div className="expert-composer">
    <form className="expert-composer-form" onSubmit={event => {
      event.preventDefault();
      if (canSend) props.onSend(message.trim());
    }}>
      <label className="min-w-0 grow"><span className="sr-only">Ask anything or a follow-up</span>
        <textarea className="w-full" rows={2} title="Enter to send · Shift+Enter for a new line" aria-description="Enter to send. Shift+Enter for a new line." maxLength={props.maxLength} disabled={busy || starting || !ready}
          value={message} onChange={event => props.onMessageChange(event.target.value)}
          placeholder={conversationActive ? "Ask a follow-up about this analysis…" : "Ask anything about your selected OSCAR dates…"}
          onKeyDown={event => {
            // IME confirmation must not submit a partially composed message.
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            if (canSend && !event.repeat) event.currentTarget.form?.requestSubmit();
          }} />
      </label>
      <button type="submit" disabled={!canSend}>Send</button>
      {busy && <button className="secondary" type="button" onClick={props.onStop}>Stop</button>}
    </form>
  </div>;
}

export function ExpertConversationActions(props: {
  busy: boolean; starting: boolean; conversationActive: boolean;
  onNewConversation(): void; onClearConversation(): void; onClearHistory(): void;
}) {
  const { busy, starting, conversationActive } = props;
  return <div className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Conversation actions">
      <button type="button" className="secondary" disabled={busy || starting} onClick={props.onNewConversation}>New Conversation</button>
      <button type="button" className="secondary" disabled={!conversationActive || starting} onClick={props.onClearConversation}>Clear Conversation</button>
      <button type="button" className="secondary" disabled={starting} onClick={props.onClearHistory}>Clear All AI History</button>
    </div>;
}
