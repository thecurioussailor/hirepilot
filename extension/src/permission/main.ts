import '../sidepanel/index.css';

/*
 * Chrome can't show the microphone prompt inside a side panel. Permission is
 * per extension (not per page), so granting it here once lets the side panel
 * use the mic from then on.
 */
const root = document.getElementById('root')!;
root.className = 'mx-auto mt-24 max-w-md space-y-4 p-6 text-center text-sm';

function render(title: string, body: string, closeable = false) {
  root.innerHTML = '';
  const h = document.createElement('h1');
  h.className = 'text-lg font-semibold';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'text-slate-500';
  p.textContent = body;
  root.append(h, p);
  if (closeable) {
    const b = document.createElement('button');
    b.className = 'rounded bg-indigo-600 px-4 py-2 text-white';
    b.textContent = 'Close this tab';
    b.onclick = () => window.close();
    root.append(b);
  }
}

async function requestMic() {
  render('Allow microphone for HirePilot', 'Click "Allow" in the prompt Chrome shows near the address bar.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // we only needed the permission
    render('Microphone allowed', 'Go back to the HirePilot side panel and click the mic button.', true);
    setTimeout(() => window.close(), 2500);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError') {
      render(
        'Microphone blocked',
        'Click the icon at the left of the address bar, set Microphone to "Allow", then reload this page.',
      );
    } else if (name === 'NotFoundError') {
      render('No microphone found', 'Connect a microphone or check macOS System Settings → Privacy → Microphone for Chrome.');
    } else {
      render('Could not access the microphone', String(err));
    }
  }
}

void requestMic();
