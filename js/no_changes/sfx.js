// ==========================================
// IMMUTABLE MODULE: MIDI SYNTH SFX & FIREWORKS (js/no_changes/sfx.js)
// Reutiliza o AudioContext existente para não criar múltiplos clientes no Windows Audio
// ==========================================
window.playUiSound = function(type) {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const ctx = window.audioCtx || window.uiAudioCtx || (window.uiAudioCtx = new AudioContextClass({ latencyHint: 'playback' }));
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        const playNote = (freq, startOffset, duration, vol = 0.07, wave = 'sine') => {
            const now = ctx.currentTime + startOffset;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = wave;
            osc.frequency.setValueAtTime(freq, now);

            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(vol, now + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + duration + 0.02);
        };

        if (type === 'join_call') {
            playNote(349.23, 0.00, 0.20, 0.08, 'sine');
            playNote(440.00, 0.06, 0.20, 0.08, 'sine');
            playNote(523.25, 0.12, 0.24, 0.09, 'sine');
            playNote(783.99, 0.18, 0.34, 0.07, 'sine');
        } else if (type === 'leave_call') {
            playNote(659.25, 0.00, 0.16, 0.07, 'sine');
            playNote(523.25, 0.07, 0.16, 0.07, 'sine');
            playNote(392.00, 0.14, 0.28, 0.08, 'sine');
        } else if (type === 'chat_in') {
            playNote(880.00, 0.00, 0.10, 0.05, 'sine');
            playNote(1318.51, 0.045, 0.18, 0.06, 'sine');
        } else if (type === 'chat_out') {
            playNote(659.25, 0.00, 0.08, 0.04, 'sine');
        } else if (type === 'peer_join') {
            playNote(587.33, 0.00, 0.16, 0.05, 'sine');
            playNote(880.00, 0.08, 0.24, 0.05, 'sine');
        }
    } catch (e) {}
};

window.triggerFireworks = function() {
    if (typeof confetti === 'undefined') return;
    confetti({
        particleCount: 80,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#10b981', '#fbbf24', '#ef4444', '#3b82f6']
    });
};