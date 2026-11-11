export function createCamera(video: HTMLVideoElement, onDisconnect: () => void, bridge = window.idlewild) {
  let stream: MediaStream | null = null;
  let pending: Promise<void> | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending: Promise<unknown> | null = null;
  let live = false;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  function release() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    live = false;
    if (stream) for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
    stream = null;
    video.srcObject = null;
  }

  async function shutdown() {
    release();
    await Promise.allSettled([pending, sending]);
    if (bridge) await bridge.allowCamera(false);
  }

  async function stop() {
    generation++;
    await shutdown();
  }

  return {
    get active() { return stream !== null; },
    get deviceId() { return stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null; },
    async devices() {
      if (!navigator.mediaDevices) throw new Error('Camera access requires the desktop app or localhost.');
      return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    },
    async start(deviceId: string | null) {
      const token = ++generation;
      await shutdown();
      if (token !== generation) return;
      pending = (async () => {
        try {
          if (bridge) await bridge.allowCamera(true);
          if (token !== generation) return;
          const opened = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 30 },
          } });
          if (token !== generation) { opened.getTracks().forEach(track => track.stop()); return; }
          stream = opened;
          for (const track of opened.getVideoTracks()) track.onended = () => { release(); onDisconnect(); };
          video.srcObject = opened;
          await video.play();
          if (token !== generation) release();
        } catch (error) {
          release();
          if (bridge) await bridge.allowCamera(false);
          throw error;
        }
      })();
      try { await pending; } finally { pending = null; }
    },
    async startLive() {
      if (!bridge) throw new Error('Live measurement requires the Electron desktop app.');
      if (!stream || !context) throw new Error('Start a camera preview first.');
      const token = generation;
      await bridge.startLive(true);
      if (token !== generation || !stream) { await bridge.stopLive(); return; }
      live = true;
      let lastStamp = 0;
      const tick = async () => {
        if (!live || token !== generation || !stream) return;
        try {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            const ratio = Math.min(640 / video.videoWidth, 480 / video.videoHeight, 1);
            canvas.width = Math.max(2, Math.floor(video.videoWidth * ratio / 2) * 2);
            canvas.height = Math.max(2, Math.floor(video.videoHeight * ratio / 2) * 2);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            lastStamp = Math.max(lastStamp + 1, Math.floor((performance.timeOrigin + performance.now()) * 1000));
            sending = bridge.sendFrame({ bytes: new Uint8Array(pixels.data.buffer), width: canvas.width, height: canvas.height, stride: canvas.width * 4, timestampUs: lastStamp });
            await sending;
          }
        } catch {
          release();
          onDisconnect();
          return;
        } finally { sending = null; }
        if (live && token === generation) timer = setTimeout(() => { void tick(); }, 50);
      };
      void tick();
    },
    stop,
  };
}
