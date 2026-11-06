export type DialogButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export type DialogLayout = {
  direction: 'row' | 'column';
  buttons: DialogButton[];
  /** What tapping outside / Android back does: the cancel button, or just close (null). */
  dismiss: DialogButton | null;
};

const ACKNOWLEDGE: DialogButton = { text: 'Entendido' };

/**
 * Same button contract as React Native's Alert.alert, arranged like a sheet:
 * up to two buttons side by side (cancel first), more stacked (cancel last).
 */
export function layoutDialog(buttons: DialogButton[] | undefined): DialogLayout {
  const list = buttons && buttons.length > 0 ? buttons : [ACKNOWLEDGE];
  const cancel = list.find((b) => b.style === 'cancel') ?? null;
  const others = list.filter((b) => b !== cancel);

  if (list.length <= 2) {
    return { direction: 'row', buttons: cancel ? [cancel, ...others] : others, dismiss: cancel };
  }
  return { direction: 'column', buttons: cancel ? [...others, cancel] : others, dismiss: cancel };
}
