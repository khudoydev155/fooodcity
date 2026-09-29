// Ikkala panel (to'liq admin va kuryer) tomonidan ishlatiladigan ovozli
// signal — App.tsx va courier.tsx orasida bir-birini import qilib
// aylanma bog'liqlik (circular import) hosil bo'lmasligi uchun alohida
// faylga chiqarilgan.
export function playBeep(): void {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    // Birinchi ton
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
    // Ikkinchi ton (echo effekt)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(660, ctx.currentTime + 0.45);
    gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.45);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.85);
    osc2.start(ctx.currentTime + 0.45);
    osc2.stop(ctx.currentTime + 0.85);
  } catch (e) {
    console.warn('Audio beep failed:', e);
  }
}
