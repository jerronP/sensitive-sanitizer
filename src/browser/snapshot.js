// snapshot.js
export const nodeMap = new Map();
let nodeCounter = 0;

export async function serializeElement(el, frame, depth = 0) {
  if (!el) return null;

  const props = await el.evaluate((node) => {
    if (!node || !node.isConnected) return null;

    const role = node.getAttribute("role") || node.tagName.toLowerCase();
    const name =
      node.getAttribute("aria-label") ||
      node.getAttribute("alt") ||
      node.getAttribute("placeholder") ||
      (node.tagName.match(/input|textarea|select/i) ? "" : node.textContent?.trim()) ||
      "";

    return {
      role,
      name,
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      type: node.getAttribute("type"),
      disabled: node.disabled || false,
      checked: node.checked || false,
      value: node.value ?? null,
      hasShadowRoot: !!node.shadowRoot,
    };
  });

  if (!props) return null;

  // assign unique nodeId
  props.nodeId = `node-${++nodeCounter}`;
  nodeMap.set(props.nodeId, el);

  // compute path
  props.path = await el.evaluate((node) => {
    if (!node || !node.isConnected) return "";
    let path = [];
    while (node && node.nodeType === 1) {
      let selector = node.nodeName.toLowerCase();
      if (node.id) {
        selector += `#${node.id}`;
        path.unshift(selector);
        break;
      } else {
        let sib = node,
          nth = 1;
        while ((sib = sib.previousElementSibling)) nth++;
        selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      node = node.parentNode;
    }
    return path.join(" > ");
  });

  // ✅ descend into shadow DOM safely
  if (props.hasShadowRoot) {
    try {
      const shadowRootHandle = await el.evaluateHandle((n) => n.shadowRoot || null);
      if (shadowRootHandle) {
        const shadowChildren = await shadowRootHandle.$$(
          "button, a, input, select, textarea, [role], [contenteditable='true']"
        );
        props.shadowChildren = [];
        for (const child of shadowChildren) {
          const serialized = await serializeElement(child, frame, depth + 1);
          if (serialized) props.shadowChildren.push(serialized);
        }
      }
    } catch (err) {
      props.shadowChildren = [];
    }
  }

  return props;
}

export async function getSnapshot(page) {
  nodeMap.clear();
  nodeCounter = 0;
  const snapshot = [];

  async function processFrame(frame, frameUrl = null) {
    const all = await frame.$$("*");

    for (const el of all) {
      const [isInteractable, isShadowHost] = await Promise.all([
        el.evaluate((n) =>
          !!(
            n.matches &&
            n.matches("button, a, input, select, textarea, [role], [contenteditable='true']")
          )
        ),
        el.evaluate((n) => !!n.shadowRoot),
      ]);

      if (isInteractable || isShadowHost) {
        const serialized = await serializeElement(el, frame);
        if (serialized) {
          if (frameUrl) serialized.frameUrl = frameUrl;
          snapshot.push(serialized);
        }
      }
    }

    for (const child of frame.childFrames()) {
      await processFrame(child, child.url());
    }
  }

  await processFrame(page.mainFrame());
  return snapshot;
}
