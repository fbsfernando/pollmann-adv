export type NotifyNovoAndamentoInput = {
  processoNumero: string
  andamentoExternalId: string
  andamentoDescricao: string
  documentoPath?: string | null
}

export type NotifyResult =
  | { status: 'sent'; providerMessageId?: string }
  | { status: 'pending'; error: string }

export type NotificationSender = (
  input: NotifyNovoAndamentoInput
) => Promise<{ messageId?: string }>

export const notifyNovoAndamento = async (
  sender: NotificationSender,
  payload: NotifyNovoAndamentoInput
): Promise<NotifyResult> => {
  try {
    const result = await sender(payload)
    return { status: 'sent', providerMessageId: result.messageId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown-notification-error'
    return { status: 'pending', error: message }
  }
}
