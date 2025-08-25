import { chromium } from "playwright";

/* -------------------------------------------------------------------------- */
/*                           SNAPSHOT (MCP-style)                              */
/* -------------------------------------------------------------------------- */

// --- Global counters and maps for snapshot ---
let nodeCounter = 0;
const nodeMap = new Map(); // nodeId -> ElementHandle

// Recursive function: serialize element + shadow roots
async function serializeElement(el, frame, depth = 0) {
  const props = await el.evaluate((node) => {
    const role = node.getAttribute("role") || node.tagName.toLowerCase();
    const name =
      node.getAttribute("aria-label") ||
      node.getAttribute("alt") ||
      node.getAttribute("placeholder") || // include placeholder as a name source
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

  // Assign unique nodeId
  props.nodeId = `node-${++nodeCounter}`;
  nodeMap.set(props.nodeId, el); // Store handle

  // Build a unique path (for debugging)
  props.path = await el.evaluate((node) => {
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

  // ✅ Recursively descend into shadow roots
  if (props.hasShadowRoot) {
    const shadowRootHandle = await el.evaluateHandle((n) => n.shadowRoot);
    // Only pick "necessary" / interactable children from inside this shadow root
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

// Snapshot function (main + iframes + shadow roots)
async function getSnapshot(page) {
  nodeMap.clear();
  nodeCounter = 0;
  const snapshot = [];

  async function processFrame(frame, frameUrl = null) {
    // We include interactables + any element that is a shadow host.
    const all = await frame.$$("*");

    for (const el of all) {
      const isInteractable = await el.evaluate((n) =>
        !!(
          n.matches &&
          n.matches("button, a, input, select, textarea, [role], [contenteditable='true']")
        )
      );
      const isShadowHost = await el.evaluate((n) => !!n.shadowRoot);

      // Only serialize interactables and shadow hosts (to pierce deeper)
      if (isInteractable || isShadowHost) {
        const serialized = await serializeElement(el, frame);
        if (frameUrl) serialized.frameUrl = frameUrl;
        snapshot.push(serialized);
      }
    }

    // Recurse into iframes
    for (const child of frame.childFrames()) {
      await processFrame(child, child.url());
    }
  }

  await processFrame(page.mainFrame());
  return snapshot;
}

/* -------------------------------------------------------------------------- */
/*                         ACTION EXECUTION (AI plan)                          */
/* -------------------------------------------------------------------------- */

/**
 * Descend into shadow roots based on an array of prerequisites like:
 * [
 *   { action: "switchToShadowRoot", target: "my-form" },
 *   { action: "switchToShadowRoot", target: "my-input" }
 * ]
 * Returns a JSHandle that is either the page (if none) or the deepest shadowRoot.
 */
async function enterShadowChain(page, prerequisite) {
  let context = page; // either page or a shadowRoot handle

  if (!prerequisite || prerequisite.length === 0) return context;

  for (const pre of prerequisite) {
    if (pre.action !== "switchToShadowRoot") continue;

    const target = pre.target;
    console.log(`🔍 Switching to shadow host: ${target}`);

    let hostHandle;

    if (context === page) {
      // First lookup: directly in the DOM
      hostHandle = await page.$(target);
    } else {
      // Lookup inside a shadow root OR slotted elements
      hostHandle = await context.evaluateHandle((root, selector) => {
        // Try shadowRoot children
        let found = root.querySelector(selector);
        if (found) return found;

        // Try assigned slotted elements
        if (root.host && root.host.shadowRoot) {
          const slots = root.querySelectorAll("slot");
          for (const slot of slots) {
            const assigned = slot.assignedElements?.() || [];
            const match = assigned.find(el => el.matches(selector));
            if (match) return match;
          }
        }
        return null;
      }, target);
    }

    if (!hostHandle) {
      console.log(`⚠️ Shadow host "${target}" not found at this level. Staying in current context.`);
      continue;
    }

    // Get its shadowRoot (if it has one)
    const shadowRoot = await hostHandle.evaluateHandle(n => n.shadowRoot || null);

    if (!shadowRoot) {
      console.log(`⚠️ "${target}" has no shadowRoot (maybe slotted). Staying at current context.`);
      continue;
    }

    context = shadowRoot;
    console.log(`✅ Entered shadow root of: ${target}`);
  }

  return context;
}



/**
 * Find an input inside the current context by placeholder, name, or id.
 * Works when context is the page (Frame) or a shadowRoot JSHandle.
 */
async function findInputInContext(context, targetStr) {
  // Try placeholder exact match
  let handle = await context.evaluateHandle(
    (root, t) =>
      root.querySelector(`input[placeholder="${t}"]`) ||
      root.querySelector(`textarea[placeholder="${t}"]`),
    targetStr
  );
  if (handle) return handle;

  // Try by name
  handle = await context.evaluateHandle(
    (root, t) => root.querySelector(`input[name="${t}"], textarea[name="${t}"]`),
    targetStr
  );
  if (handle) return handle;

  // Try by id
  handle = await context.evaluateHandle(
    (root, t) => root.querySelector(`#${CSS.escape(t)}`),
    targetStr
  );
  return handle;
}

async function executeActions(page, actions) {
  for (const step of actions) {
    const { playwrightAction, prerequisite } = step;

    switch (playwrightAction.action) {
      case "goto": {
        await page.goto(playwrightAction.url);
        console.log(`🌍 Navigated to ${playwrightAction.url}`);
        break;
      }

      case "input": {
        // Enter the specified shadow chain first (if any)
        const context = await enterShadowChain(page, prerequisite ?? []);

        // Find the input inside that context
        const elHandle = await findInputInContext(context, playwrightAction.target);
        if (!elHandle) {
          throw new Error(
            `❌ Input not found for target "${playwrightAction.target}" in current shadow context.`
          );
        }
        const el = elHandle.asElement();
        if (!el) throw new Error("❌ Target is not an element.");

        await el.fill(""); // clear
        await el.type(playwrightAction.value);
        console.log(`⌨️ Filled "${playwrightAction.target}" with "${playwrightAction.value}"`);
        break;
      }

      default:
        console.log(`⚠️ Action "${playwrightAction.action}" not implemented.`);
        break;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                              MOCK AI RESPONSE                               */
/* -------------------------------------------------------------------------- */

const mockAIResponse = {
  actions: [
    {
      sequence: 1,
      playwrightAction: {
        action: "goto",
        url: "https://mattkenefick.github.io/sample-shadow-dom/",
      },
    },
    {
      sequence: 2,
      prerequisite: [
        { action: "switchToShadowRoot", target: "my-form" },
        { action: "switchToShadowRoot", target: "my-input" },
      ],
      playwrightAction: {
        action: "input",
        // This is the actual placeholder from the sample page input:
        target: "My input placeholder",
        value: "testUsername",
      },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*                                   RUNNER                                   */
/* -------------------------------------------------------------------------- */

(async () => {
  const browser = await chromium.launch({ headless: false }); // visible for debugging
  const page = await browser.newPage();

  try {
    // 1) Navigate once (so we can snapshot before/after as you prefer)
    await page.goto("https://mattkenefick.github.io/sample-shadow-dom/");

    // 2) Take a snapshot (this is what you'd send to the AI together with the prompt)
    const snapshotBefore = await getSnapshot(page);
    console.log(
      "📸 Snapshot captured (count):",
      snapshotBefore.length,
      "(printing first 1 item)"
    );
    if (snapshotBefore.length) {
      console.log(JSON.stringify(snapshotBefore));
    }

    // 3) Execute AI actions (mocked)
    await executeActions(page, mockAIResponse.actions);

    // 4) Optionally snapshot again after actions
    const snapshotAfter = await getSnapshot(page);
    console.log("📸 Snapshot after actions (count):", snapshotAfter.length);
  } catch (err) {
    console.error("💥 ERROR:", err.message);
  }

  await page.waitForTimeout(8000); // keep open to observe
  // await browser.close();
})();
