export const nodeMap = new Map();

let nodeCounter = 0;

export async function serializeElement(el, frame, depth = 0) {
  const props = await el.evaluate((node) => {
    const role = node.getAttribute("role") || node.tagName.toLowerCase();
    const name =
      node.getAttribute("aria-label") ||
      node.getAttribute("alt") ||
      node.getAttribute("placeholder") ||
      node.textContent?.trim() ||
      "";

    return {
      role,
      name,
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      type: node.getAttribute("type"),
      disabled: node.disabled || false,
      checked: node.checked || false,
      value: node.value || null,
      hasShadowRoot: !!node.shadowRoot,
    };
  });

  props.nodeId = `node-${++nodeCounter}`;
  nodeMap.set(props.nodeId, el);

  props.path = await el.evaluate((node) => {
    let path = [];
    while (node && node.nodeType === 1) {
      let selector = node.nodeName.toLowerCase();
      if (node.id) {
        selector += `#${node.id}`;
        path.unshift(selector);
        break;
      } else {
        let sib = node, nth = 1;
        while ((sib = sib.previousElementSibling)) nth++;
        selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      node = node.parentNode;
    }
    return path.join(" > ");
  });

  if (props.hasShadowRoot) {
    const shadowRootHandle = await el.evaluateHandle((n) => n.shadowRoot);
    const shadowChildren = await shadowRootHandle.$$(
      "button, a, input, select, textarea, [role], [contenteditable='true']"
    );
    props.shadowChildren = [];
    for (const child of shadowChildren) {
      props.shadowChildren.push(await serializeElement(child, frame, depth + 1));
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
      const isInteractable = await el.evaluate((n) =>
        !!(
          n.matches &&
          n.matches("button, a, input, select, textarea, [role], [contenteditable='true']")
        )
      );
      const isShadowHost = await el.evaluate((n) => !!n.shadowRoot);

      if (isInteractable || isShadowHost) {
        const serialized = await serializeElement(el, frame);
        if (frameUrl) serialized.frameUrl = frameUrl;
        snapshot.push(serialized);
      }
    }
    for (const child of frame.childFrames()) {
      await processFrame(child, child.url());
    }
  }

  await processFrame(page.mainFrame());
  return snapshot;
}