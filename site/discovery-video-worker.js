'use strict';

// @ffmpeg/core 0.12.10, verified against the npm release before loading.
// https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15
const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/';
const coreScript = 'ffmpeg-core.js';
const coreWasm = 'ffmpeg-core.wasm';

async function verifiedCoreFile(name, sha256) {
  const response = await fetch(coreBase + name, {credentials: 'omit'});
  if (!response.ok) throw new Error('Could not download ' + name);
  const bytes = await response.arrayBuffer();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== sha256) throw new Error('Unexpected FFmpeg core hash');
  return bytes;
}

async function loadCore() {
  const [script, wasmBinary] = await Promise.all([
    verifiedCoreFile(coreScript, 'b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21'),
    verifiedCoreFile(coreWasm, '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7'),
  ]);
  const url = URL.createObjectURL(new Blob([script], {type: 'text/javascript'}));
  try {
    importScripts(url);
    return await createFFmpegCore({wasmBinary});
  } finally {
    URL.revokeObjectURL(url);
  }
}

self.addEventListener('message', async ({data}) => {
  let ffmpeg;
  try {
    ffmpeg = await loadCore();
  } catch (error) {
    console.warn('Discovery video converter could not load', error);
    self.postMessage({status: 'download_failed'});
    return;
  }

  try {
    const {file, source, destination, args, maxBytes} = data;
    ffmpeg.FS.writeFile(source, new Uint8Array(await file.arrayBuffer()));
    let diagnostic = '';
    ffmpeg.setLogger(({type, message}) => {
      if (type === 'stderr') diagnostic = (diagnostic + '\n' + message).slice(-2048);
    });
    // The core supplies -y. This worker has a fresh filesystem for each file.
    ffmpeg.exec(...args.filter(argument => argument !== '-n'));
    const size = ffmpeg.FS.analyzePath(destination).exists ? ffmpeg.FS.stat(destination).size : 0;
    if (size > maxBytes) {
      self.postMessage({status: 'too_large'});
    } else if (ffmpeg.ret !== 0 || size === 0) {
      console.warn('FFmpeg discovery conversion failed', ffmpeg.ret, diagnostic);
      self.postMessage({status: 'failed'});
    } else {
      const {buffer} = ffmpeg.FS.readFile(destination);
      self.postMessage({status: 'ok', buffer}, [buffer]);
    }
  } catch (error) {
    console.warn('Discovery video conversion failed', error);
    self.postMessage({status: 'failed'});
  }
}, {once: true});
