import { ValidAction, PlayerAction } from '../game/types';

/**
 * Manages the action bar UI: fold, check/call, raise with slider.
 */
export class ActionBar {
  private btnFold: HTMLButtonElement;
  private btnCheckCall: HTMLButtonElement;
  private btnRaise: HTMLButtonElement;
  private betSlider: HTMLInputElement;
  private betAmountInput: HTMLInputElement;
  private actionBar: HTMLElement;
  private timerBar: HTMLElement;
  private presetButtons: NodeListOf<HTMLButtonElement>;

  private validActions: ValidAction[] = [];
  private pot: number = 0;
  private currentBet: number = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  onAction: ((action: PlayerAction, amount?: number) => void) | null = null;

  constructor() {
    this.btnFold = document.getElementById('btn-fold') as HTMLButtonElement;
    this.btnCheckCall = document.getElementById('btn-check-call') as HTMLButtonElement;
    this.btnRaise = document.getElementById('btn-raise') as HTMLButtonElement;
    this.betSlider = document.getElementById('bet-slider') as HTMLInputElement;
    this.betAmountInput = document.getElementById('bet-amount') as HTMLInputElement;
    this.actionBar = document.getElementById('action-bar') as HTMLElement;
    this.timerBar = document.getElementById('timer-bar') as HTMLElement;
    this.presetButtons = document.querySelectorAll('.btn-preset') as NodeListOf<HTMLButtonElement>;

    this.setupListeners();
  }

  private setupListeners(): void {
    this.btnFold.addEventListener('click', () => {
      this.onAction?.('fold');
      this.hide();
    });

    this.btnCheckCall.addEventListener('click', () => {
      const callAction = this.validActions.find(a => a.action === 'call');
      const checkAction = this.validActions.find(a => a.action === 'check');
      if (checkAction) {
        this.onAction?.('check');
      } else if (callAction) {
        this.onAction?.('call', callAction.minAmount);
      }
      this.hide();
    });

    this.btnRaise.addEventListener('click', () => {
      const amount = parseInt(this.betAmountInput.value);
      if (!isNaN(amount) && amount > 0) {
        this.onAction?.('raise', amount);
        this.hide();
      }
    });

    this.betSlider.addEventListener('input', () => {
      this.betAmountInput.value = this.betSlider.value;
    });

    this.betAmountInput.addEventListener('input', () => {
      const val = parseInt(this.betAmountInput.value);
      if (!isNaN(val)) {
        this.betSlider.value = String(val);
      }
    });

    this.presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        const raiseAction = this.validActions.find(a => a.action === 'raise');
        if (!raiseAction) return;

        let amount: number;
        if (preset === 'all') {
          amount = raiseAction.maxAmount!;
        } else {
          const fraction = parseFloat(preset!);
          amount = Math.max(
            raiseAction.minAmount!,
            Math.min(Math.floor(this.pot * fraction), raiseAction.maxAmount!)
          );
        }
        this.betAmountInput.value = String(amount);
        this.betSlider.value = String(amount);
      });
    });
  }

  show(validActions: ValidAction[], pot: number, currentBet: number, deadline: number): void {
    this.validActions = validActions;
    this.pot = pot;
    this.currentBet = currentBet;

    // Update check/call button
    const callAction = validActions.find(a => a.action === 'call');
    const checkAction = validActions.find(a => a.action === 'check');
    const raiseAction = validActions.find(a => a.action === 'raise');

    if (checkAction) {
      this.btnCheckCall.textContent = 'Check';
    } else if (callAction) {
      this.btnCheckCall.textContent = `Call $${callAction.minAmount}`;
    }

    // Update raise controls
    if (raiseAction) {
      this.btnRaise.style.display = '';
      this.betSlider.min = String(raiseAction.minAmount!);
      this.betSlider.max = String(raiseAction.maxAmount!);
      this.betSlider.value = String(raiseAction.minAmount!);
      this.betAmountInput.min = String(raiseAction.minAmount!);
      this.betAmountInput.max = String(raiseAction.maxAmount!);
      this.betAmountInput.value = String(raiseAction.minAmount!);
      (this.betSlider.parentElement as HTMLElement).style.display = '';
      (document.querySelector('.preset-buttons') as HTMLElement).style.display = '';
    } else {
      this.btnRaise.style.display = 'none';
      (this.betSlider.parentElement as HTMLElement).style.display = 'none';
      (document.querySelector('.preset-buttons') as HTMLElement).style.display = 'none';
    }

    // Start timer
    this.startTimer(deadline);

    this.actionBar.classList.remove('hidden');
  }

  hide(): void {
    this.actionBar.classList.add('hidden');
    this.stopTimer();
  }

  private startTimer(deadline: number): void {
    this.stopTimer();
    const totalDuration = deadline - Date.now();

    this.timerInterval = setInterval(() => {
      const remaining = deadline - Date.now();
      const pct = Math.max(0, (remaining / totalDuration) * 100);
      this.timerBar.style.width = `${pct}%`;

      if (remaining <= 0) {
        this.stopTimer();
        // Auto-fold
        this.onAction?.('fold');
        this.hide();
      }
    }, 100);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.timerBar.style.width = '100%';
  }
}

